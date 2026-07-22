// Public API — Phase 1: ported core scoring engine + `core` check pack.
// Config-driven pack composition, the `ai-craft` company pack, CLI, and the
// multi-repo runner are later phases (see docs/ai/specs/0011-harness-audit.md).

export type {
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
export { DIMENSIONS } from './types.js';

export type { CreateScanOptions, ScanOverlay } from './scan.js';
export { createScanContext } from './scan.js';

export type { ExtraRootEntry, GateMode, ResolvedScanConfig, ScopeFlag } from './scan-config.js';
export { DEFAULT_SCAN_CONFIG } from './scan-config.js';

export {
  buildReport,
  buildReportFromContext,
  buildReportFromScanContext,
  DOCS_BASE_URL,
  LEVEL_NAMES,
  LEVEL_REQUIREMENTS,
  TOOL_VERSION,
} from './score.js';

export type { CheckPack } from './packs/core/index.js';
export { ALL_CHECKS, corePack } from './packs/core/index.js';

export { renderBadge } from './report/badge.js';
export { renderMarkdown } from './report/markdown.js';
export { renderTerminal } from './report/terminal.js';

export type { ToolId, HarnessKind, PathSpec } from './harness/registry.js';
export { toolDisplayName } from './harness/registry.js';
export type { HarnessArtifact } from './harness/collectors.js';
export { detectHarnesses } from './harness/collectors.js';
