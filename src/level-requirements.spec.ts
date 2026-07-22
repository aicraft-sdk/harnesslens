import { describe, expect, it } from 'vitest';
import type { DimensionId, DimensionScore } from './types.js';
import {
  computeLevel,
  DEFAULT_LEVEL_REQUIREMENTS,
  evalLevelRequirementSpec,
  specToLabel,
} from './level-requirements.js';

function dim(id: DimensionId, percent: number): DimensionScore {
  return { id, title: id, earned: percent, max: 100, percent };
}

describe('evalLevelRequirementSpec', () => {
  const dims = new Map<DimensionId, DimensionScore>([
    ['context', dim('context', 45)],
    ['skills', dim('skills', 10)],
    ['hooks', dim('hooks', 35)],
  ]);

  it('{ dimension, minPercent } is met when the dimension percent is >= minPercent', () => {
    expect(evalLevelRequirementSpec({ dimension: 'context', minPercent: 40 }, dims, 0)).toBe(true);
    expect(evalLevelRequirementSpec({ dimension: 'context', minPercent: 60 }, dims, 0)).toBe(false);
  });

  it('{ dimension, minPercent } treats a missing dimension as 0%', () => {
    expect(evalLevelRequirementSpec({ dimension: 'ci', minPercent: 1 }, dims, 0)).toBe(false);
  });

  it('{ anyOf } is met when at least one branch is met', () => {
    const spec = { anyOf: [{ dimension: 'skills', minPercent: 30 }, { dimension: 'hooks', minPercent: 30 }] };
    expect(evalLevelRequirementSpec(spec, dims, 0)).toBe(true);
  });

  it('{ anyOf } is unmet when no branch is met', () => {
    const spec = { anyOf: [{ dimension: 'skills', minPercent: 30 }, { dimension: 'hooks', minPercent: 90 }] };
    expect(evalLevelRequirementSpec(spec, dims, 0)).toBe(false);
  });

  it('{ totalMinPercent } compares against totalPercent, not any dimension', () => {
    expect(evalLevelRequirementSpec({ totalMinPercent: 80 }, dims, 81)).toBe(true);
    expect(evalLevelRequirementSpec({ totalMinPercent: 80 }, dims, 79)).toBe(false);
  });
});

describe('specToLabel', () => {
  it('formats each shape identically to the original hardcoded ladder labels', () => {
    expect(specToLabel({ dimension: 'context', minPercent: 40 })).toBe('context ≥ 40%');
    expect(specToLabel({ anyOf: [{ dimension: 'skills', minPercent: 30 }, { dimension: 'hooks', minPercent: 30 }] })).toBe(
      'skills ≥ 30% or hooks ≥ 30%',
    );
    expect(specToLabel({ totalMinPercent: 80 })).toBe('total ≥ 80%');
  });
});

describe('computeLevel — DEFAULT_LEVEL_REQUIREMENTS byte-identical to the pre-override ladder', () => {
  // Recorded from `buildReportFromScanContext` against the level-0..level-4
  // fixtures before this phase existed (dimension percents + expected level).
  const cases: Array<{ label: string; dims: DimensionScore[]; total: number; expectedIndex: number; expectedGaps: string[] }> = [
    {
      label: 'level-0 fixture profile',
      dims: [dim('context', 5), dim('skills', 0), dim('hooks', 0), dim('sensors', 0), dim('ci', 0), dim('hygiene', 57)],
      total: 13,
      expectedIndex: 0,
      expectedGaps: ['context ≥ 40%'],
    },
    {
      label: 'level-1 fixture profile',
      dims: [dim('context', 45), dim('skills', 0), dim('hooks', 0), dim('sensors', 0), dim('ci', 0), dim('hygiene', 57)],
      total: 20,
      expectedIndex: 1,
      expectedGaps: ['context ≥ 60%', 'skills ≥ 30% or hooks ≥ 30%'],
    },
    {
      label: 'level-2 fixture profile',
      dims: [dim('context', 100), dim('skills', 71), dim('hooks', 0), dim('sensors', 0), dim('ci', 0), dim('hygiene', 87)],
      total: 48,
      expectedIndex: 2,
      expectedGaps: ['sensors ≥ 60%', 'ci ≥ 50%'],
    },
    {
      label: 'level-3 fixture profile',
      dims: [dim('context', 100), dim('skills', 100), dim('hooks', 0), dim('sensors', 100), dim('ci', 79), dim('hygiene', 87)],
      total: 81,
      expectedIndex: 3,
      expectedGaps: ['hooks ≥ 70%'],
    },
    {
      label: 'level-4 fixture profile',
      dims: [dim('context', 100), dim('skills', 100), dim('hooks', 100), dim('sensors', 100), dim('ci', 100), dim('hygiene', 100)],
      total: 100,
      expectedIndex: 4,
      expectedGaps: [],
    },
  ];

  for (const { label, dims, total, expectedIndex, expectedGaps } of cases) {
    it(`${label}: lands on level ${expectedIndex} with default requirements`, () => {
      const level = computeLevel(dims, total);
      expect(level.index).toBe(expectedIndex);
      expect(level.nextLevelGaps).toEqual(expectedGaps);
    });
  }

  it('DEFAULT_LEVEL_REQUIREMENTS has exactly 4 levels, same as the original ladder', () => {
    expect(DEFAULT_LEVEL_REQUIREMENTS).toHaveLength(4);
  });
});

describe('computeLevel — custom requirements override', () => {
  it('a lowered threshold reaches a level the default requirements would not', () => {
    const dims = [dim('context', 100), dim('skills', 71), dim('hooks', 0), dim('sensors', 0), dim('ci', 0), dim('hygiene', 87)];
    const total = 48;

    const defaultResult = computeLevel(dims, total);
    expect(defaultResult.index).toBe(2);

    const lowered = [
      DEFAULT_LEVEL_REQUIREMENTS[0]!,
      DEFAULT_LEVEL_REQUIREMENTS[1]!,
      [{ dimension: 'sensors', minPercent: 0 }, { dimension: 'ci', minPercent: 0 }],
      DEFAULT_LEVEL_REQUIREMENTS[3]!,
    ];
    const overriddenResult = computeLevel(dims, total, lowered);
    expect(overriddenResult.index).toBe(3);
  });
});
