import { describe, it, expect } from 'vitest';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload';

const baseFields: CanonicalSubmissionFields = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

describe('buildCanonicalPayload -- backward compatibility (Durable Decision 2)', () => {
  it('omitting checks[] produces the exact pre-extension canonical string (no "checks" key at all)', () => {
    const result = buildCanonicalPayload(baseFields);
    expect(result).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"frameworkMapping":{},"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
    expect(result.includes('"checks"')).toBe(false);
  });
});

describe('buildCanonicalPayload -- checks[] extension', () => {
  const fieldsWithChecks: CanonicalSubmissionFields = {
    ...baseFields,
    frameworkMapping: {
      ci: { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI04', 'ASI08'] },
    },
    checks: [
      {
        id: 'CTX-01',
        dimension: 'context',
        title: 'Has AGENTS.md',
        points: 5,
        earned: 5,
        passed: true,
        evidence: 'Found AGENTS.md at repo root',
      },
    ],
  };

  it('includes checks[] between dimensions and frameworkMapping, fixed per-entry field order', () => {
    const result = buildCanonicalPayload(fieldsWithChecks);
    expect(result).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"checks":[{"id":"CTX-01","dimension":"context","title":"Has AGENTS.md","points":5,' +
        '"earned":5,"passed":true,"evidence":"Found AGENTS.md at repo root"}],' +
        '"frameworkMapping":{"ci":{"nistFunctions":["Measure","Manage"],"owaspIds":["ASI04","ASI08"]}},' +
        '"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
  });

  it('an empty checks[] array is distinguishable from an omitted checks[] field', () => {
    const withEmpty = buildCanonicalPayload({ ...baseFields, checks: [] });
    const omitted = buildCanonicalPayload(baseFields);
    expect(withEmpty).not.toBe(omitted);
    expect(withEmpty.includes('"checks":[]')).toBe(true);
  });

  it('tamper-evidence: altering one check\'s evidence text after signing changes the canonical string', () => {
    const tampered = buildCanonicalPayload({
      ...fieldsWithChecks,
      checks: [{ ...fieldsWithChecks.checks![0]!, evidence: 'ALTERED' }],
    });
    expect(tampered).not.toBe(buildCanonicalPayload(fieldsWithChecks));
  });

  it('drops remediation/docsUrl-shaped extra keys if present on input (only 7 fields are ever serialized)', () => {
    const withExtra = {
      ...fieldsWithChecks,
      checks: [{ ...fieldsWithChecks.checks![0]!, remediation: 'fix it', docsUrl: 'https://x' } as never],
    };
    const result = buildCanonicalPayload(withExtra);
    expect(result.includes('remediation')).toBe(false);
    expect(result.includes('docsUrl')).toBe(false);
  });
});
