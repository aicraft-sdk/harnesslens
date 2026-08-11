import { describe, expect, it } from 'vitest';
import { corePack } from '../core/index.js';
import { aiCraftPack, exitGateChecks } from './index.js';

describe('aiCraftPack', () => {
  it('declares a distinct "AIC-" id prefix that never collides with any core check id', () => {
    const coreIds = new Set(corePack.checks.map((c) => c.id));
    expect(aiCraftPack.checks.length).toBeGreaterThan(0);
    for (const check of aiCraftPack.checks) {
      expect(check.id).toMatch(/^AIC-\d+$/);
      expect(coreIds.has(check.id)).toBe(false);
    }
  });

  it('declares the "company" and "exit-gate" dimensions', () => {
    expect(aiCraftPack.dimensions).toEqual([
      { id: 'company', title: 'AI-Craft Conventions' },
      { id: 'exit-gate', title: 'Agent Output Exit-Gate Readiness' },
    ]);
  });

  it('assigns every non-exit-gate check to the "company" dimension, and every exit-gate check to "exit-gate"', () => {
    const exitGateIds = new Set(exitGateChecks.map((c) => c.id));
    for (const check of aiCraftPack.checks) {
      const expected = exitGateIds.has(check.id) ? 'exit-gate' : 'company';
      expect(check.dimension).toBe(expected);
    }
  });
});
