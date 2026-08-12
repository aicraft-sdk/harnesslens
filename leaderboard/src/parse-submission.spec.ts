// leaderboard/src/parse-submission.spec.ts
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

  it('drops a frameworkMapping entry whose nistFunctions/owaspIds contain non-string elements, instead of coercing them via String()', () => {
    const result = parseSubmission(
      {
        ...VALID,
        frameworkMapping: { context: { nistFunctions: [{}, null], owaspIds: ['Injection'] } },
      },
      'bad-elements.json',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The malformed entry is dropped entirely — never stringified into ["[object Object]", "null"].
      expect(result.entry.frameworkMapping).toEqual({});
    }
  });

  it('fails open (drops just the one entry) on a malformed frameworkMapping entry, unlike dimensions[] which fails the whole submission closed', () => {
    // Deliberate asymmetry: frameworkMapping is supplementary/display metadata (NIST/OWASP
    // tags shown alongside a dimension), not the scored data itself — dropping one malformed
    // mapping loses a display label, not correctness. dimensions[] IS the scored data, so a
    // malformed entry there fails the whole submission closed instead. See parse-submission.ts
    // for the matching inline rationale comment.
    const result = parseSubmission(
      { ...VALID, frameworkMapping: { context: { nistFunctions: 'not-an-array', owaspIds: [] } } },
      'malformed-mapping.json',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.frameworkMapping).toEqual({});
    }
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

  it('ignores a hostile "__proto__"/"constructor" key nested inside frameworkMapping, never lets it surface in the parsed entry, and leaves both Object.prototype and the entry\'s own prototype unpolluted (P2 nested vector, catalog #10 nested variant)', () => {
    // Unlike the top-level "hostile" test above (extra key on the submission root), this
    // targets the exact vector Phase 3's prior REM-FIX cycle (commit 1e5900c) touched:
    // frameworkMapping's own key set is attacker-controlled data (dimension ids echoed back
    // from the raw JSON), so a literal "__proto__"/"constructor" key inside frameworkMapping
    // itself is the real nested-object pollution surface, not just the submission root.
    // Built via JSON.parse (not object-literal syntax) so "__proto__" becomes a genuine own
    // data property of the raw parsed object, matching what a real submissions/*.json file
    // parsed by JSON.parse would actually produce.
    const hostileMapping = JSON.parse(
      '{"__proto__": {"polluted": true, "nistFunctions": ["Govern"], "owaspIds": []}, ' +
        '"constructor": {"nistFunctions": ["Govern"], "owaspIds": []}, ' +
        '"context": {"nistFunctions": ["Govern"], "owaspIds": []}}',
    );

    const result = parseSubmission({ ...VALID, frameworkMapping: hostileMapping }, 'nested-proto.json');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the legitimate "context" key survives — the hostile keys never appear at all,
      // not even with sanitized/overwritten values.
      expect(Object.keys(result.entry.frameworkMapping)).toEqual(['context']);
      // The parsed frameworkMapping object's own prototype link was never reassigned via a
      // "__proto__"-keyed bracket assignment.
      expect(Object.getPrototypeOf(result.entry.frameworkMapping)).toBe(Object.prototype);
    }
    // Global Object.prototype and a brand-new object stay unpolluted after the call.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects the whole submission when a single dimensions[] entry is malformed, fail-closed (edge-case catalog #12)', () => {
    // dimensions[] IS the scored data (unlike frameworkMapping's fail-open display metadata —
    // see the "fails open" test above), so a malformed entry must reject the whole submission
    // rather than silently trimming it, per parse-submission.ts's inline rationale comment.
    const result = parseSubmission(
      {
        ...VALID,
        dimensions: [
          VALID.dimensions[0],
          { id: 'skills', title: 'Skills & Delegation', max: 5, percent: 100 }, // missing "earned"
        ],
      },
      'malformed-dimension-entry.json',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('dimensions');
    }
  });

  it('rejects a submission whose dimensions[] contains a "__proto__"/"constructor"/"prototype" id (defense-in-depth against prototype-chain lookups downstream, REM-FIX)', () => {
    // dimension.id was previously restricted only to "is a string" — never checked against the
    // same __proto__/constructor/prototype guard already applied to frameworkMapping keys. A
    // "__proto__" dimension id lets a plain-object bracket lookup on frameworkMapping fall
    // through the prototype chain in render.ts. Fail the whole submission closed, matching
    // dimensions[]'s existing fail-closed posture for malformed entries.
    const result = parseSubmission(
      {
        ...VALID,
        dimensions: [{ ...VALID.dimensions[0], id: '__proto__' }],
      },
      'proto-dimension-id.json',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('dimensions');
    }
  });

  it('accepts a frameworkMapping entry whose key is a dimension id no longer present in the current registry, as opaque display data (edge-case catalog #13)', () => {
    // parseSubmission has no registry cross-check — frameworkMapping keys are shape-validated
    // display metadata, never validated against harnesslens's live dimension list. A stale
    // key from registry drift must survive as-is rather than crashing or being silently dropped.
    const result = parseSubmission(
      {
        ...VALID,
        frameworkMapping: {
          ...VALID.frameworkMapping,
          'no-longer-exists': { nistFunctions: ['Govern'], owaspIds: [] },
        },
      },
      'unknown-dimension-id.json',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.frameworkMapping['no-longer-exists']).toEqual({
        nistFunctions: ['Govern'],
        owaspIds: [],
      });
    }
  });
});
