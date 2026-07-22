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
 *  - The maturity ladder now lives in `./level-requirements.js` as
 *    config-overridable `LevelRequirementSpec[][]` data (see
 *    `DEFAULT_LEVEL_REQUIREMENTS`) instead of a hardcoded closure ladder.
 *    Every report-building entry point defaults its `requirements` parameter
 *    to `DEFAULT_LEVEL_REQUIREMENTS`, so existing callers are unaffected.
 */

import { detectHarnesses } from './harness/index.js';
import { buildOverlays } from './harness/global-paths.js';
import { computeLevel, DEFAULT_LEVEL_REQUIREMENTS } from './level-requirements.js';
import { corePack } from './packs/core/index.js';
import { composeRegistry, type ComposedRegistry } from './registry.js';
import { createScanContext } from './scan.js';
import { DEFAULT_SCAN_CONFIG, type ResolvedScanConfig } from './scan-config.js';
import type {
  Check,
  CheckOutcome,
  CheckResult,
  DimensionInfo,
  DimensionScore,
  LevelRequirementSpec,
  Report,
  ScanContext,
  ScoreSnapshot,
} from './types.js';

export { LEVEL_NAMES, LEVEL_REQUIREMENTS, DEFAULT_LEVEL_REQUIREMENTS } from './level-requirements.js';
export type { LevelRequirementSpec } from './types.js';

export const DOCS_BASE_URL = 'https://paladini.github.io/harness-score/guide/measure-and-improve';
export const TOOL_VERSION = '1.3.1';

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

function buildSnapshot(
  ctx: ScanContext,
  registry: ComposedRegistry,
  requirements: LevelRequirementSpec[][],
): ScoreSnapshot {
  const checks = runChecks(ctx, registry.checks);
  const dimensions = scoreDimensions(checks, registry.dimensions);
  const earned = checks.reduce((sum, c) => sum + c.earned, 0);
  const max = checks.reduce((sum, c) => sum + c.points, 0);
  const percent = max === 0 ? 0 : Math.round((earned / max) * 100);
  return {
    level: computeLevel(dimensions, percent, requirements),
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
  requirements: LevelRequirementSpec[][] = DEFAULT_LEVEL_REQUIREMENTS,
): Report {
  const maturity = buildSnapshot(maturityCtx, registry, requirements);
  let effective = maturity;
  if (effectiveCtx !== maturityCtx) {
    const effSnapshot = buildSnapshot(effectiveCtx, registry, requirements);
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
  requirements: LevelRequirementSpec[][] = DEFAULT_LEVEL_REQUIREMENTS,
): Report {
  const root = rootInput;
  const resolved = config ?? DEFAULT_SCAN_CONFIG;

  const maturityCtx = createScanContext(root);
  const hasExtraScopes = resolved.scopes.user || resolved.scopes.system || resolved.extraRoots.length > 0;

  if (!hasExtraScopes) {
    return buildReportFromContext(maturityCtx, maturityCtx, resolved, undefined, registry, requirements);
  }

  const { overlays, resolvedRoots } = buildOverlays(root, resolved.scopes, resolved.extraRoots);
  const effectiveCtx = createScanContext(root, { overlays });
  return buildReportFromContext(maturityCtx, effectiveCtx, resolved, resolvedRoots, registry, requirements);
}

/** Build a report from a pre-built ScanContext using the default (repo-only, maturity-gated) config. */
export function buildReportFromScanContext(
  ctx: ScanContext,
  registry: ComposedRegistry = DEFAULT_REGISTRY,
  requirements: LevelRequirementSpec[][] = DEFAULT_LEVEL_REQUIREMENTS,
): Report {
  return buildReportFromContext(ctx, ctx, DEFAULT_SCAN_CONFIG, undefined, registry, requirements);
}
