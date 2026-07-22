/**
 * The `ai-craft` company check pack — general-purpose checks for company
 * conventions this monorepo's own manual audit surfaced as gaps in
 * harness-score's repo-root-only detection: a plugin-delivered AI harness
 * (the headline false-negative fix), NX/changesets release conventions,
 * AI-First governance + spec traceability, and two hygiene template gaps.
 *
 * Composed exactly like `packs/core/index.ts` via `defineCheck`/`definePack`
 * (`../../define.js`), but declares its own `company` dimension (`DimensionId`
 * was widened in Phase 2 specifically to support this) so its score is
 * additive to — never mixed into — the 6 core dimensions.
 */

import { defineCheck, definePack } from '../../define.js';
import type { Check, CheckPack, DimensionInfo } from '../../types.js';
import { governanceChecks } from './governance.js';
import { hygieneChecks } from './hygiene.js';
import { monorepoChecks } from './monorepo.js';
import { pluginDetectionChecks } from './plugin-detection.js';

export const COMPANY_DIMENSION: DimensionInfo = { id: 'company', title: 'AI-Craft Conventions' };

export const aiCraftPack: CheckPack = definePack({
  id: 'ai-craft',
  checks: [
    ...pluginDetectionChecks,
    ...monorepoChecks,
    ...governanceChecks,
    ...hygieneChecks,
  ].map(defineCheck),
  dimensions: [COMPANY_DIMENSION],
});

export const AI_CRAFT_CHECKS: Check[] = aiCraftPack.checks;

export { governanceChecks, hygieneChecks, monorepoChecks, pluginDetectionChecks };
