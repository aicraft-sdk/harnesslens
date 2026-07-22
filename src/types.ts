/**
 * Ported verbatim (contract-identical) from harness-score's `types.ts`
 * (https://github.com/paladini/harness-score, MIT — see NOTICE).
 * `GateMode` now comes from `./scan-config.js` (Phase 1 local module) rather
 * than upstream's `config.ts`, since the full config-file loader is Phase 2.
 */

export type CoreDimensionId = 'context' | 'skills' | 'hooks' | 'sensors' | 'ci' | 'hygiene';

/**
 * The 6 built-in dimension ids retain autocomplete via `CoreDimensionId`, but
 * packs (Phase 2) may declare arbitrary custom dimension ids (e.g. a company
 * pack's "company" dimension) — the `(string & {})` branch widens the type
 * without losing literal-string autocomplete for the known ids.
 */
export type DimensionId = CoreDimensionId | (string & {});

export interface DimensionInfo {
  id: DimensionId;
  title: string;
}

export const DIMENSIONS: DimensionInfo[] = [
  { id: 'context', title: 'Context & Guides' },
  { id: 'skills', title: 'Skills & Commands' },
  { id: 'hooks', title: 'Hooks & Guardrails' },
  { id: 'sensors', title: 'Sensors & Feedback' },
  { id: 'ci', title: 'CI Feedback' },
  { id: 'hygiene', title: 'Hygiene & Safety' },
];

/** Everything a check may look at. Built once per scan; checks never touch the filesystem directly. */
export interface ScanContext {
  /** Absolute path of the scanned repository root. */
  root: string;
  /** All file paths relative to root, POSIX separators, sorted. */
  files: string[];
  /** True if the scan hit MAX_FILES and stopped before the tree was fully walked. */
  truncated: boolean;
  /** True when the relative path exists as a file. */
  has(relPath: string): boolean;
  /** File content as UTF-8, or null when missing/unreadable. Cached. */
  read(relPath: string): string | null;
  /** All files whose relative path matches the regex. */
  matching(re: RegExp): string[];
}

export interface CheckOutcome {
  passed: boolean;
  /** Human-readable proof: what was found (or not found) and where. */
  evidence: string;
}

export interface Check {
  /** Stable id like "CTX-01"; doubles as the docs anchor (lowercased). */
  id: string;
  dimension: DimensionId;
  title: string;
  points: number;
  /** One actionable sentence shown when the check fails. */
  remediation: string;
  run(ctx: ScanContext): CheckOutcome;
}

/**
 * A composable bundle of checks (and optionally custom dimensions) that the
 * registry (`registry.ts`) flattens into the check/dimension list `score.ts`
 * scores. `core` (the 36 ported upstream checks) is the built-in pack;
 * external packs are added via config (`config.ts`) without forking this
 * package. `levelRules` is reserved for a future maturity-ladder override
 * mechanism and is intentionally untyped/unused in Phase 2.
 */
export interface CheckPack {
  id: string;
  checks: Check[];
  dimensions?: DimensionInfo[];
  levelRules?: unknown;
}

export interface CheckResult {
  id: string;
  dimension: DimensionId;
  title: string;
  points: number;
  earned: number;
  passed: boolean;
  evidence: string;
  remediation: string;
  docsUrl: string;
}

export interface DimensionScore {
  id: DimensionId;
  title: string;
  earned: number;
  max: number;
  /** 0–100, rounded. */
  percent: number;
}

export interface LevelInfo {
  /** 0–4 */
  index: number;
  name: string;
  /** What is missing to reach the next level; empty at L4. */
  nextLevelGaps: string[];
}

/** One scored snapshot (maturity or effective). */
export interface ScoreSnapshot {
  level: LevelInfo;
  score: { earned: number; max: number; percent: number };
  dimensions: DimensionScore[];
  checks: CheckResult[];
  detectedHarnesses: string[];
}

import type { GateMode } from './scan-config.js';

export interface Report {
  tool: { name: string; version: string };
  root: string;
  /** True if the scan hit its file-count cap before fully walking the tree — results may be incomplete. */
  truncated: boolean;
  /** Scopes included in each score. */
  scopes: { maturity: ['repo']; effective: Array<'repo' | 'user' | 'system' | string> };
  /** Which score `--min-level` and CI gates use. */
  gate: GateMode;
  /** Absolute paths resolved for non-repo scopes (informational). */
  resolvedRoots?: Array<{ scope: string; absPath: string }>;
  /** Tool IDs with at least one harness artifact detected in the repo (informational). */
  detectedHarnesses: string[];
  /** Repository-only score — canonical for CI when gate is maturity. */
  level: LevelInfo;
  score: { earned: number; max: number; percent: number };
  dimensions: DimensionScore[];
  checks: CheckResult[];
  /** Repo ∪ configured global/extra scopes — what the agent likely sees on this machine. */
  effective: ScoreSnapshot;
}
