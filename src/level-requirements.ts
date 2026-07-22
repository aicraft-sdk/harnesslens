/**
 * The maturity ladder, in its config-overridable `LevelRequirementSpec[][]`
 * form, plus the interpreter that evaluates it. Split out of `score.ts` to
 * keep that file under its line budget (see patterns.md).
 *
 * `DEFAULT_LEVEL_REQUIREMENTS` is the data-equivalent of the ladder this
 * package used before `LevelRequirementSpec` existed (a hardcoded
 * `Requirement[][]` of closures using `dimAtLeast(id, pct)` plus two inline
 * custom requirements for "skills≥30% OR hooks≥30%" and "total≥80%").
 * Proven byte-identical via `parity.spec.ts`/`api.spec.ts`'s unmodified
 * fixture-level assertions (level-0..level-4 fixtures still land on their
 * expected level with no `levels` override) plus this file's own
 * `level-requirements.spec.ts` interpreter tests.
 *
 * Mirrored verbatim in the guide's Maturity Model chapter — change both
 * together.
 */

import type { DimensionId, DimensionScore, LevelInfo, LevelRequirementSpec } from './types.js';

export const LEVEL_NAMES = ['Unharnessed', 'Documented', 'Guided', 'Sensing', 'Self-correcting'] as const;

export const DEFAULT_LEVEL_REQUIREMENTS: LevelRequirementSpec[][] = [
  /* L1 Documented */ [{ dimension: 'context', minPercent: 40 }],
  /* L2 Guided */ [
    { dimension: 'context', minPercent: 60 },
    {
      anyOf: [
        { dimension: 'skills', minPercent: 30 },
        { dimension: 'hooks', minPercent: 30 },
      ],
    },
    { dimension: 'hygiene', minPercent: 50 },
  ],
  /* L3 Sensing */ [
    { dimension: 'sensors', minPercent: 60 },
    { dimension: 'ci', minPercent: 50 },
  ],
  /* L4 Self-correcting */ [
    { dimension: 'hooks', minPercent: 70 },
    { totalMinPercent: 80 },
  ],
];

/**
 * Backward-compat alias for the pre-`LevelRequirementSpec` export name
 * (`score.ts`'s old hardcoded `Requirement[][]`) — same ladder, now in the
 * JSON-serializable spec shape. Re-exported from `index.ts` so existing
 * imports of `LEVEL_REQUIREMENTS` keep compiling.
 */
export const LEVEL_REQUIREMENTS: LevelRequirementSpec[][] = DEFAULT_LEVEL_REQUIREMENTS;

/** Evaluate a single `LevelRequirementSpec` against one snapshot's dimension scores/total. */
export function evalLevelRequirementSpec(
  spec: LevelRequirementSpec,
  dims: Map<DimensionId, DimensionScore>,
  totalPercent: number,
): boolean {
  if ('totalMinPercent' in spec) return totalPercent >= spec.totalMinPercent;
  if ('anyOf' in spec) {
    return spec.anyOf.some((entry) => (dims.get(entry.dimension)?.percent ?? 0) >= entry.minPercent);
  }
  return (dims.get(spec.dimension)?.percent ?? 0) >= spec.minPercent;
}

/** Human-readable label for a spec, used in `LevelInfo.nextLevelGaps`. */
export function specToLabel(spec: LevelRequirementSpec): string {
  if ('totalMinPercent' in spec) return `total ≥ ${spec.totalMinPercent}%`;
  if ('anyOf' in spec) {
    return spec.anyOf.map((entry) => `${entry.dimension} ≥ ${entry.minPercent}%`).join(' or ');
  }
  return `${spec.dimension} ≥ ${spec.minPercent}%`;
}

/**
 * Walk the ladder: a level is reached when every spec in its array is met
 * (AND-combined). Stops at the first unmet level and reports its unmet
 * specs as `nextLevelGaps`.
 */
export function computeLevel(
  dimensions: DimensionScore[],
  totalPercent: number,
  requirements: LevelRequirementSpec[][] = DEFAULT_LEVEL_REQUIREMENTS,
): LevelInfo {
  const dims = new Map<DimensionId, DimensionScore>(dimensions.map((d) => [d.id, d]));
  let index = 0;
  let gaps: string[] = [];
  for (let level = 0; level < requirements.length; level += 1) {
    const unmet = requirements[level]!.filter((spec) => !evalLevelRequirementSpec(spec, dims, totalPercent));
    if (unmet.length === 0) {
      index = level + 1;
    } else {
      gaps = unmet.map((spec) => specToLabel(spec));
      break;
    }
  }
  return { index, name: LEVEL_NAMES[index]!, nextLevelGaps: gaps };
}
