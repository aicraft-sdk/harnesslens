/**
 * Thin identity/validation helpers for authoring checks and packs with
 * type-safe autocomplete. They don't transform their input — `Check` and
 * `CheckPack` are already the full contract — but typing a literal through
 * `defineCheck`/`definePack` gives editors contextual completion for the
 * interface's fields, the same purpose `defineConfig`-style helpers serve in
 * other ecosystems.
 */

import type { Check, CheckPack } from './types.js';

export function defineCheck(check: Check): Check {
  return check;
}

export function definePack(pack: CheckPack): CheckPack {
  return pack;
}
