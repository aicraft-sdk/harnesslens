import { describe, expect, it } from 'vitest';
import { defineCheck, definePack } from './define.js';
import type { Check, CheckPack } from './types.js';

describe('defineCheck / definePack', () => {
  it('defineCheck returns the same check object (identity helper)', () => {
    const check: Check = {
      id: 'FIX-01',
      dimension: 'context',
      title: 'Fixture check',
      points: 3,
      remediation: 'Do the fixture thing.',
      run: () => ({ passed: true, evidence: 'fixture' }),
    };

    expect(defineCheck(check)).toBe(check);
  });

  it('definePack returns the same pack object (identity helper)', () => {
    const pack: CheckPack = { id: 'fixture', checks: [] };

    expect(definePack(pack)).toBe(pack);
  });
});
