/**
 * Ported from harness-score's `score.ts`
 * (https://github.com/paladini/harness-score, MIT — see NOTICE).
 * Differences from upstream (contract-preserving):
 *  - Checks and dimensions now come from a `ComposedRegistry` (`./registry.js`)
 *    instead of a hardcoded `ALL_CHECKS`/`DIMENSIONS` pair — Phase 2 replaces
 *    Phase 1's `ALL_CHECKS = corePack.checks` wiring with pluggable pack
 *    composition. Every report-building entry point defaults its `registry`
 *    parameter to `DEFAULT_REGISTRY` (core pack only, no overrides), so
 *    existing callers (and `parity.spec.ts`) are unaffected.
 *  - `ResolvedScanConfig`/`GateMode` come from `./scan-config.js` instead of
 *    upstream's `config.ts` (the full `.harness-audit.json` loader lives in
 *    `./config.js`).
 */

import { detectHarnesses } from './harness/index.js';
import { buildOverlays } from './harness/global-paths.js';
import { corePack } from './packs/core/index.js';
import { composeRegistry, type ComposedRegistry } from './registry.js';
import { createScanContext } from './scan.js';
import { DEFAULT_SCAN_CONFIG, type ResolvedScanConfig } from './scan-config.js';
import type {
  Check,
  CheckOutcome,
  CheckResult,
  DimensionId,
  DimensionInfo,
  DimensionScore,
  LevelInfo,
  Report,
  ScanContext,
  ScoreSnapshot,
} from './types.js';

export const DOCS_BASE_URL = 'https://paladini.github.io/harness-score/guide/measure-and-improve';
export const TOOL_VERSION = '1.3.1';

export const LEVEL_NAMES = ['Unharnessed', 'Documented', 'Guided', 'Sensing', 'Self-correcting'] as const;

/** Default composition: the `core` pack only, no overrides — Phase 1's exact behavior. */
export const DEFAULT_REGISTRY: ComposedRegistry = composeRegistry({ packs: [corePack] });

function runChecks(ctx: ScanContext, checks: Check[]): CheckResult[] {
  return checks.map((check) => {
    let outcome: CheckOutcome;
    try {
      outcome = check.run(ctx);
    } catch (error) {
      outcome = { passed: false, evidence: `Check failed to execute: ${String(error)}` };
    }
    return {
      id: check.id,
      dimension: check.dimension,
      title: check.title,
      points: check.points,
      earned: outcome.passed ? check.points : 0,
      passed: outcome.passed,
      evidence: outcome.evidence,
      remediation: check.remediation,
      docsUrl: `${DOCS_BASE_URL}#${check.id.toLowerCase()}`,
    };
  });
}

function scoreDimensions(checks: CheckResult[], dimensions: DimensionInfo[]): DimensionScore[] {
  return dimensions.map((dim) => {
    const own = checks.filter((c) => c.dimension === dim.id);
    const earned = own.reduce((sum, c) => sum + c.earned, 0);
    const max = own.reduce((sum, c) => sum + c.points, 0);
    return {
      id: dim.id,
      title: dim.title,
      earned,
      max,
      percent: max === 0 ? 0 : Math.round((earned / max) * 100),
    };
  });
}

interface Requirement {
  label: string;
  met(dims: Map<DimensionId, DimensionScore>, totalPercent: number): boolean;
}

const dimAtLeast = (id: DimensionId, pct: number): Requirement => ({
  label: `${id} ≥ ${pct}%`,
  met: (dims) => (dims.get(id)?.percent ?? 0) >= pct,
});

/**
 * The maturity ladder. A level is reached when ALL of its requirements
 * (and every previous level's) are met. Mirrored verbatim in the guide's
 * Maturity Model chapter — change both together.
 */
export const LEVEL_REQUIREMENTS: Requirement[][] = [
  /* L1 Documented */ [dimAtLeast('context', 40)],
  /* L2 Guided */ [
    dimAtLeast('context', 60),
    {
      label: 'skills ≥ 30% or hooks ≥ 30%',
      met: (dims) => (dims.get('skills')?.percent ?? 0) >= 30 || (dims.get('hooks')?.percent ?? 0) >= 30,
    },
    dimAtLeast('hygiene', 50),
  ],
  /* L3 Sensing */ [dimAtLeast('sensors', 60), dimAtLeast('ci', 50)],
  /* L4 Self-correcting */ [
    dimAtLeast('hooks', 70),
    { label: 'total ≥ 80%', met: (_dims, total) => total >= 80 },
  ],
];

function computeLevel(dimensions: DimensionScore[], totalPercent: number): LevelInfo {
  const dims = new Map<DimensionId, DimensionScore>(dimensions.map((d) => [d.id, d]));
  let index = 0;
  let gaps: string[] = [];
  for (let level = 0; level < LEVEL_REQUIREMENTS.length; level += 1) {
    const unmet = LEVEL_REQUIREMENTS[level]!.filter((r) => !r.met(dims, totalPercent));
    if (unmet.length === 0) {
      index = level + 1;
    } else {
      gaps = unmet.map((r) => r.label);
      break;
    }
  }
  return { index, name: LEVEL_NAMES[index]!, nextLevelGaps: gaps };
}

function buildSnapshot(ctx: ScanContext, registry: ComposedRegistry): ScoreSnapshot {
  const checks = runChecks(ctx, registry.checks);
  const dimensions = scoreDimensions(checks, registry.dimensions);
  const earned = checks.reduce((sum, c) => sum + c.earned, 0);
  const max = checks.reduce((sum, c) => sum + c.points, 0);
  const percent = max === 0 ? 0 : Math.round((earned / max) * 100);
  return {
    level: computeLevel(dimensions, percent),
    score: { earned, max, percent },
    dimensions,
    checks,
    detectedHarnesses: detectHarnesses(ctx),
  };
}

function snapshotsEqual(a: ScoreSnapshot, b: ScoreSnapshot): boolean {
  if (a.level.index !== b.level.index || a.score.percent !== b.score.percent) return false;
  if (a.checks.length !== b.checks.length) return false;
  for (let i = 0; i < a.checks.length; i += 1) {
    if (a.checks[i]!.passed !== b.checks[i]!.passed) return false;
  }
  return true;
}

export function buildReportFromContext(
  maturityCtx: ScanContext,
  effectiveCtx: ScanContext,
  config: ResolvedScanConfig,
  resolvedRoots: Report['resolvedRoots'],
  registry: ComposedRegistry = DEFAULT_REGISTRY,
): Report {
  const maturity = buildSnapshot(maturityCtx, registry);
  let effective = maturity;
  if (effectiveCtx !== maturityCtx) {
    const effSnapshot = buildSnapshot(effectiveCtx, registry);
    if (!snapshotsEqual(maturity, effSnapshot)) {
      effective = effSnapshot;
    }
  }

  return {
    tool: { name: 'harness-audit', version: TOOL_VERSION },
    root: maturityCtx.root,
    truncated: maturityCtx.truncated || effectiveCtx.truncated,
    scopes: { maturity: ['repo'], effective: config.effectiveScopes },
    gate: config.gate,
    resolvedRoots: resolvedRoots && resolvedRoots.length > 0 ? resolvedRoots : undefined,
    detectedHarnesses: maturity.detectedHarnesses,
    level: maturity.level,
    score: maturity.score,
    dimensions: maturity.dimensions,
    checks: maturity.checks,
    effective,
  };
}

/** Build a full report for a repository root with optional scope configuration. */
export function buildReport(
  rootInput: string,
  config?: ResolvedScanConfig,
  registry: ComposedRegistry = DEFAULT_REGISTRY,
): Report {
  const root = rootInput;
  const resolved = config ?? DEFAULT_SCAN_CONFIG;

  const maturityCtx = createScanContext(root);
  const hasExtraScopes = resolved.scopes.user || resolved.scopes.system || resolved.extraRoots.length > 0;

  if (!hasExtraScopes) {
    return buildReportFromContext(maturityCtx, maturityCtx, resolved, undefined, registry);
  }

  const { overlays, resolvedRoots } = buildOverlays(root, resolved.scopes, resolved.extraRoots);
  const effectiveCtx = createScanContext(root, { overlays });
  return buildReportFromContext(maturityCtx, effectiveCtx, resolved, resolvedRoots, registry);
}

/** Build a report from a pre-built ScanContext using the default (repo-only, maturity-gated) config. */
export function buildReportFromScanContext(
  ctx: ScanContext,
  registry: ComposedRegistry = DEFAULT_REGISTRY,
): Report {
  return buildReportFromContext(ctx, ctx, DEFAULT_SCAN_CONFIG, undefined, registry);
}
