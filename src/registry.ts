/**
 * Composes `CheckPack[]` into the flat `Check[]` + `DimensionInfo[]` list
 * `score.ts` scores. Replaces Phase 1's hardcoded `ALL_CHECKS = corePack.checks`
 * wiring so multiple packs, per-check enable/disable, per-check reweighting,
 * and pack-declared (or config-declared) custom dimensions all compose
 * without forking this package.
 */

import type { Check, CheckPack, DimensionInfo } from './types.js';
import { DIMENSIONS } from './types.js';

export interface CheckOverride {
  enabled?: boolean;
  points?: number;
}

export interface ComposeRegistryOptions {
  packs: CheckPack[];
  /** Keyed by check id. `enabled: false` drops the check; `points` reweights it. */
  checkOverrides?: Record<string, CheckOverride>;
  /** Extra dimensions to add on top of the base 6 and any pack-declared ones. */
  extraDimensions?: DimensionInfo[];
}

export interface ComposedRegistry {
  checks: Check[];
  dimensions: DimensionInfo[];
}

function composeChecks(packs: CheckPack[], checkOverrides: Record<string, CheckOverride>): Check[] {
  const checks: Check[] = [];
  const seenIds = new Set<string>();

  for (const pack of packs) {
    for (const check of pack.checks) {
      if (seenIds.has(check.id)) {
        throw new Error(`composeRegistry: duplicate check id "${check.id}" (pack "${pack.id}")`);
      }
      seenIds.add(check.id);

      const override = checkOverrides[check.id];
      if (override?.enabled === false) continue;

      const points = override?.points ?? check.points;
      checks.push(points === check.points ? check : { ...check, points });
    }
  }

  return checks;
}

function composeDimensions(packs: CheckPack[], extraDimensions: DimensionInfo[]): DimensionInfo[] {
  const dimensions: DimensionInfo[] = [...DIMENSIONS];
  const seenIds = new Set(dimensions.map((d) => d.id));

  const addDimension = (dim: DimensionInfo): void => {
    if (seenIds.has(dim.id)) return;
    seenIds.add(dim.id);
    dimensions.push(dim);
  };

  for (const pack of packs) {
    for (const dim of pack.dimensions ?? []) addDimension(dim);
  }
  for (const dim of extraDimensions) addDimension(dim);

  return dimensions;
}

/** Compose enabled packs (with overrides applied) into the flat check/dimension list `score.ts` needs. */
export function composeRegistry(options: ComposeRegistryOptions): ComposedRegistry {
  const { packs, checkOverrides = {}, extraDimensions = [] } = options;
  return {
    checks: composeChecks(packs, checkOverrides),
    dimensions: composeDimensions(packs, extraDimensions),
  };
}
