/**
 * The `core` check pack — the 36 checks in this package's original core
 * check catalog. See NOTICE for third-party attribution. Organized
 * one file per dimension (`checks/{context,skills,...}.ts`
 * layout) and assembled here into a single `CheckPack`-shaped object via
 * `definePack`/`defineCheck` (see `../../define.js`).
 *
 * Phase 2: this is now one of potentially many packs the registry
 * (`../../registry.js`) composes — `ALL_CHECKS` is kept only as a
 * backward-compatible alias for `corePack.checks` (still used directly by
 * `score.ts`'s `DEFAULT_REGISTRY`).
 */

import { defineCheck, definePack } from '../../define.js';
import type { Check, CheckPack } from '../../types.js';
import { agentChecks } from './agents.js';
import { ciChecks } from './ci.js';
import { contextChecks } from './context.js';
import { hookChecks } from './hooks.js';
import { hygieneChecks } from './hygiene.js';
import { sensorChecks } from './sensors.js';
import { skillChecks } from './skills.js';

export const corePack: CheckPack = definePack({
  id: 'core',
  checks: [
    ...contextChecks,
    ...skillChecks,
    ...agentChecks,
    ...hookChecks,
    ...sensorChecks,
    ...ciChecks,
    ...hygieneChecks,
  ].map(defineCheck),
});

/** Backward-compatible alias for `corePack.checks` — the flat list of the 36 core checks. */
export const ALL_CHECKS: Check[] = corePack.checks;

export { agentChecks, ciChecks, contextChecks, hookChecks, hygieneChecks, sensorChecks, skillChecks };
