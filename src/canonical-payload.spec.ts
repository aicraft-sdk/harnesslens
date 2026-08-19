import { describe, it, expect } from 'vitest';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';

describe('buildCanonicalPayload (CLI) -- cross-package golden-file parity with backend/src/signing/canonical-payload.ts', () => {
  const baseFields: CanonicalSubmissionFields = {
    repoId: 'acme/widgets', score: 82.5, level: { index: 3, name: 'L3 Systematized' },
    dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
    frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: '2026-08-13T00:00:00.000Z',
  };

  it('backward-compat golden string -- IDENTICAL to backend Task 1.1\'s golden string', () => {
    expect(buildCanonicalPayload(baseFields)).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"frameworkMapping":{},"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
  });

  it('checks[] golden string -- IDENTICAL to backend Task 1.1\'s golden string', () => {
    const fields: CanonicalSubmissionFields = {
      ...baseFields,
      frameworkMapping: { ci: { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI04', 'ASI08'] } },
      checks: [{ id: 'CTX-01', dimension: 'context', title: 'Has AGENTS.md', points: 5, earned: 5, passed: true, evidence: 'Found AGENTS.md at repo root' }],
    };
    expect(buildCanonicalPayload(fields)).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"checks":[{"id":"CTX-01","dimension":"context","title":"Has AGENTS.md","points":5,' +
        '"earned":5,"passed":true,"evidence":"Found AGENTS.md at repo root"}],' +
        '"frameworkMapping":{"ci":{"nistFunctions":["Measure","Manage"],"owaspIds":["ASI04","ASI08"]}},' +
        '"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
  });

  it('frameworkMapping entries always serialize nistFunctions before owaspIds, regardless of the input object\'s own key order (PostgreSQL jsonb columns reorder object keys by length on storage/retrieval -- see live-proof finding, Phase 6)', () => {
    const fieldsWithReversedKeyOrder: CanonicalSubmissionFields = {
      ...baseFields,
      // Deliberately owaspIds before nistFunctions -- simulates a value that round-tripped
      // through a jsonb column and came back with keys reordered by Postgres.
      frameworkMapping: { ci: { owaspIds: ['ASI04', 'ASI08'], nistFunctions: ['Measure', 'Manage'] } as never },
    };
    const fieldsWithDeclaredKeyOrder: CanonicalSubmissionFields = {
      ...baseFields,
      frameworkMapping: { ci: { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI04', 'ASI08'] } },
    };
    expect(buildCanonicalPayload(fieldsWithReversedKeyOrder)).toBe(buildCanonicalPayload(fieldsWithDeclaredKeyOrder));
    expect(buildCanonicalPayload(fieldsWithReversedKeyOrder).includes('"nistFunctions":["Measure","Manage"],"owaspIds"')).toBe(true);
  });
});
