/**
 * The `core` check pack — the 36 checks ported from harness-score
 * (https://github.com/paladini/harness-score, MIT — see NOTICE), reorganized
 * one file per dimension (mirroring upstream's `checks/{context,skills,...}.ts`
 * layout) and assembled here into a single `CheckPack`-shaped object.
 *
 * Phase 1 wiring: `ALL_CHECKS = corePack.checks` is the only pack in use.
 * Phase 2 replaces this with config-driven pack composition (multiple packs,
 * enable/disable/reweight by id) — not built here.
 */

import type { Check } from '../../types.js';
import { agentChecks } from './agents.js';
import { ciChecks } from './ci.js';
import { contextChecks } from './context.js';
import { hookChecks } from './hooks.js';
import { hygieneChecks } from './hygiene.js';
import { sensorChecks } from './sensors.js';
import { skillChecks } from './skills.js';

export interface CheckPack {
  id: string;
  checks: Check[];
}

export const corePack: CheckPack = {
  id: 'core',
  checks: [
    ...contextChecks,
    ...skillChecks,
    ...agentChecks,
    ...hookChecks,
    ...sensorChecks,
    ...ciChecks,
    ...hygieneChecks,
  ],
};

/** Phase 1 hardcoded wiring — Phase 2 replaces this with pack composition from config. */
export const ALL_CHECKS: Check[] = corePack.checks;

export { agentChecks, ciChecks, contextChecks, hookChecks, hygieneChecks, sensorChecks, skillChecks };
