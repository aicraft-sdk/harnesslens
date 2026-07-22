import { describe, expect, it } from 'vitest';
import { composeRegistry } from './registry.js';
import type { Check, CheckPack, DimensionInfo } from './types.js';
import { DIMENSIONS } from './types.js';

function makeCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: 'FIX-01',
    dimension: 'context',
    title: 'Fixture check',
    points: 5,
    remediation: 'Do the fixture thing.',
    run: () => ({ passed: true, evidence: 'fixture' }),
    ...overrides,
  };
}

describe('composeRegistry', () => {
  it('flattens a single pack into checks and keeps the default dimensions', () => {
    const check = makeCheck();
    const pack: CheckPack = { id: 'fixture', checks: [check] };

    const registry = composeRegistry({ packs: [pack] });

    expect(registry.checks).toEqual([check]);
    expect(registry.dimensions).toEqual(DIMENSIONS);
  });

  it('composes checks from multiple packs in pack order', () => {
    const packA: CheckPack = { id: 'a', checks: [makeCheck({ id: 'A-01' })] };
    const packB: CheckPack = { id: 'b', checks: [makeCheck({ id: 'B-01' })] };

    const registry = composeRegistry({ packs: [packA, packB] });

    expect(registry.checks.map((c) => c.id)).toEqual(['A-01', 'B-01']);
  });

  it('throws on duplicate check ids across packs', () => {
    const packA: CheckPack = { id: 'a', checks: [makeCheck({ id: 'DUP-01' })] };
    const packB: CheckPack = { id: 'b', checks: [makeCheck({ id: 'DUP-01' })] };

    expect(() => composeRegistry({ packs: [packA, packB] })).toThrow(/duplicate check id "DUP-01"/);
  });

  it('excludes a check disabled via checkOverrides', () => {
    const pack: CheckPack = {
      id: 'fixture',
      checks: [makeCheck({ id: 'KEEP-01' }), makeCheck({ id: 'DROP-01' })],
    };

    const registry = composeRegistry({
      packs: [pack],
      checkOverrides: { 'DROP-01': { enabled: false } },
    });

    expect(registry.checks.map((c) => c.id)).toEqual(['KEEP-01']);
  });

  it('reweights a check point value via checkOverrides without mutating the source pack', () => {
    const original = makeCheck({ id: 'RW-01', points: 5 });
    const pack: CheckPack = { id: 'fixture', checks: [original] };

    const registry = composeRegistry({
      packs: [pack],
      checkOverrides: { 'RW-01': { points: 9 } },
    });

    expect(registry.checks[0]?.points).toBe(9);
    expect(original.points).toBe(5);
  });

  it('adds dimensions declared by a pack, deduped against the base dimensions', () => {
    const customDim: DimensionInfo = { id: 'company', title: 'Company Standards' };
    const pack: CheckPack = { id: 'fixture', checks: [], dimensions: [customDim, { id: 'context', title: 'dup' }] };

    const registry = composeRegistry({ packs: [pack] });

    expect(registry.dimensions).toEqual([...DIMENSIONS, customDim]);
  });

  it('adds dimensions passed via extraDimensions', () => {
    const customDim: DimensionInfo = { id: 'company', title: 'Company Standards' };

    const registry = composeRegistry({ packs: [], extraDimensions: [customDim] });

    expect(registry.dimensions).toEqual([...DIMENSIONS, customDim]);
  });
});
