/**
 * The `ai-craft` company check pack — general-purpose checks for company
 * conventions this monorepo's own manual audit surfaced as gaps in
 * the `core` pack's repo-root-only detection: a plugin-delivered AI harness
 * (the headline false-negative fix), NX/changesets release conventions,
 * AI-First governance + spec traceability, and two hygiene template gaps.
 *
 * Composed exactly like `packs/core/index.ts` via `defineCheck`/`definePack`
 * (`../../define.js`), but declares its own `company` and `exit-gate`
 * dimensions (`DimensionId` was widened in Phase 2 specifically to support
 * this) so their scores are additive to — never mixed into — the 6 core
 * dimensions. `exit-gate` (`exit-gate.ts`) scores Addy Osmani's 7 agent-output
 * quality dimensions as static CI/config-presence readiness checks — see the
 * Decision RFC at `docs/plans/2026-08-11-agent-exit-gate-quality-dimensions-rfc.md`.
 */

import { defineCheck, definePack } from '../../define.js';
import type { Check, CheckPack, DimensionInfo } from '../../types.js';
import { exitGateChecks } from './exit-gate.js';
import { governanceChecks } from './governance.js';
import { hygieneChecks } from './hygiene.js';
import { monorepoChecks } from './monorepo.js';
import { pluginDetectionChecks } from './plugin-detection.js';

export const COMPANY_DIMENSION: DimensionInfo = { id: 'company', title: 'AI-Craft Conventions' };
export const EXIT_GATE_DIMENSION: DimensionInfo = {
  id: 'exit-gate',
  title: 'Agent Output Exit-Gate Readiness',
};

export const aiCraftPack: CheckPack = definePack({
  id: 'ai-craft',
  checks: [
    ...pluginDetectionChecks,
    ...monorepoChecks,
    ...governanceChecks,
    ...hygieneChecks,
    ...exitGateChecks,
  ].map(defineCheck),
  dimensions: [COMPANY_DIMENSION, EXIT_GATE_DIMENSION],
});

export const AI_CRAFT_CHECKS: Check[] = aiCraftPack.checks;

export { exitGateChecks, governanceChecks, hygieneChecks, monorepoChecks, pluginDetectionChecks };
