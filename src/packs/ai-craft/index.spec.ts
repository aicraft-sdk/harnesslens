import { describe, expect, it } from 'vitest';
import { corePack } from '../core/index.js';
import { aiCraftPack } from './index.js';

describe('aiCraftPack', () => {
  it('declares a distinct "AIC-" id prefix that never collides with any core check id', () => {
    const coreIds = new Set(corePack.checks.map((c) => c.id));
    expect(aiCraftPack.checks.length).toBeGreaterThan(0);
    for (const check of aiCraftPack.checks) {
      expect(check.id).toMatch(/^AIC-\d+$/);
      expect(coreIds.has(check.id)).toBe(false);
    }
  });

  it('declares exactly one new "company" dimension', () => {
    expect(aiCraftPack.dimensions).toEqual([{ id: 'company', title: 'AI-Craft Conventions' }]);
  });

  it('assigns every check to the "company" dimension', () => {
    for (const check of aiCraftPack.checks) {
      expect(check.dimension).toBe('company');
    }
  });
});
