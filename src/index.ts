// Public API — Phase 1: ported core scoring engine + `core` check pack.
// Phase 2: config-driven pack composition (`composeRegistry`, `runAudit`).
// Phase 3: the `ai-craft` company check pack (craftflow-plugin detection,
// NX/changesets/governance/spec-traceability, hygiene templates).
// CLI + GitHub Action + multi-repo runner remain a later phase
// (see docs/ai/specs/0011-harness-audit.md).

export type {
  Check,
  CheckOutcome,
  CheckPack,
  CheckResult,
  CoreDimensionId,
  DimensionId,
  DimensionInfo,
  DimensionScore,
  LevelInfo,
  Report,
  ScanContext,
  ScoreSnapshot,
} from './types.js';
export { DIMENSIONS } from './types.js';

export { defineCheck, definePack } from './define.js';

export type { CheckOverride, ComposeRegistryOptions, ComposedRegistry } from './registry.js';
export { composeRegistry } from './registry.js';

export type { CreateScanOptions, ScanOverlay } from './scan.js';
export { createScanContext } from './scan.js';

export type { ExtraRootEntry, GateMode, ResolvedScanConfig, ScopeFlag } from './scan-config.js';
export { DEFAULT_SCAN_CONFIG } from './scan-config.js';

export type { CheckOverrideEntry, HarnessAuditConfig } from './config.js';
export {
  CONFIG_FILE_NAME,
  loadHarnessAuditConfigFile,
  resolveScanConfig,
  validateHarnessAuditConfig,
} from './config.js';

export {
  buildReport,
  buildReportFromContext,
  buildReportFromScanContext,
  DEFAULT_REGISTRY,
  DOCS_BASE_URL,
  LEVEL_NAMES,
  LEVEL_REQUIREMENTS,
  TOOL_VERSION,
} from './score.js';

export { ALL_CHECKS, corePack } from './packs/core/index.js';

export { AI_CRAFT_CHECKS, aiCraftPack, COMPANY_DIMENSION } from './packs/ai-craft/index.js';

export type { RunAuditOptions } from './api.js';
export { runAudit } from './api.js';

export { renderBadge } from './report/badge.js';
export { renderMarkdown } from './report/markdown.js';
export { renderTerminal } from './report/terminal.js';

export type { ToolId, HarnessKind, PathSpec } from './harness/registry.js';
export { toolDisplayName } from './harness/registry.js';
export type { HarnessArtifact } from './harness/collectors.js';
export { detectHarnesses } from './harness/collectors.js';
