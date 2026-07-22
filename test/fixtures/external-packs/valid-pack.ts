/**
 * Fixture module for `api.spec.ts`'s string-module-path pack-loading test.
 * A real, on-disk `CheckPack` exported via `default` — proves `runAudit`'s
 * `resolvePackEntry` string branch genuinely `import()`s and composes it,
 * not just that the string is accepted by config validation.
 */
import type { CheckPack } from '../../../src/types.js';

const pack: CheckPack = {
  id: 'fixture-valid-external',
  checks: [
    {
      id: 'FIX-EXT-01',
      dimension: 'context',
      title: 'Fixture external check (always passes)',
      points: 5,
      remediation: 'n/a — fixture always passes',
      run: () => ({ passed: true, evidence: 'fixture-valid-external always passes' }),
    },
    {
      id: 'FIX-EXT-02',
      dimension: 'context',
      title: 'Fixture external check (always fails)',
      points: 7,
      remediation: 'n/a — fixture always fails',
      run: () => ({ passed: false, evidence: 'fixture-valid-external always fails' }),
    },
  ],
};

export default pack;
