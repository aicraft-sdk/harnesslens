// tools/harness-audit-leaderboard/src/parse-submission.spec.ts
import { describe, expect, it } from 'vitest';
import { parseSubmission } from './parse-submission.js';

const VALID = {
  repoId: 'acme/widgets',
  score: 78,
  level: { index: 3, name: 'Sensing' },
  dimensions: [{ id: 'context', title: 'Context & Guides', earned: 4, max: 5, percent: 80 }],
  frameworkMapping: { context: { nistFunctions: ['Govern'], owaspIds: [] } },
  commitSha: 'abc1234',
  scannedAt: '2026-08-01T00:00:00.000Z',
};

describe('parseSubmission', () => {
  it('accepts a well-formed submission and returns exactly the allowlisted keys', () => {
    const result = parseSubmission(VALID, 'acme-widgets.json');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.entry).sort()).toEqual(
        ['commitSha', 'dimensions', 'frameworkMapping', 'level', 'repoId', 'scannedAt', 'score'].sort(),
      );
    }
  });

  it('rejects invalid JSON shape (not an object)', () => {
    const result = parseSubmission('not-an-object', 'bad.json');
    expect(result.ok).toBe(false);
  });

  it('rejects a submission missing a required field', () => {
    const { commitSha, ...missing } = VALID;
    const result = parseSubmission(missing, 'missing-field.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('commitSha');
  });

  it('rejects a submission with a wrong-typed field', () => {
    const result = parseSubmission({ ...VALID, score: '78' }, 'bad-type.json');
    expect(result.ok).toBe(false);
  });

  it('rejects an unsafe repoId', () => {
    const result = parseSubmission({ ...VALID, repoId: '../../etc/passwd' }, 'bad-id.json');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-ISO scannedAt', () => {
    const result = parseSubmission({ ...VALID, scannedAt: 'not-a-date' }, 'bad-date.json');
    expect(result.ok).toBe(false);
  });

  it('ignores extraneous keys, including __proto__, and never mass-assigns them (P1/P2)', () => {
    const hostile = JSON.parse(
      `{"__proto__": {"polluted": true}, "isAdmin": true, ${JSON.stringify(VALID).slice(1)}`,
    );
    const result = parseSubmission(hostile, 'hostile.json');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.entry)).not.toContain('isAdmin');
      expect((result.entry as unknown as Record<string, unknown>)['__proto__']).not.toEqual({ polluted: true });
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('accepts an HTML/script payload as a valid string (parsing ≠ sanitizing)', () => {
    // Uses dimensions[0].title (free-text, no pattern restriction) rather than repoId,
    // which is already covered by the "rejects an unsafe repoId" test above and is
    // pattern-restricted by REPO_ID_RE — see Task 3.4's fixture design rationale.
    const result = parseSubmission(
      { ...VALID, dimensions: [{ ...VALID.dimensions[0], title: '<img src=x onerror=alert(1)>' }] },
      'xss.json',
    );
    // Still shape-valid — sanitization is render.ts's job, not the parser's (Behavior Contract).
    expect(result.ok).toBe(true);
  });
});
