// CLI-side mirror of `backend/src/signing/canonical-payload.ts` -- a deliberate, tested duplicate,
// not a shared import (the two packages have no workspace link). Cross-package parity is enforced
// by a byte-exact golden-string fixture asserted identically in both `canonical-payload.spec.ts`
// files (Durable Decision 12). Any change here MUST be mirrored on the backend side too, and vice
// versa -- the golden-string tests are what catch accidental drift.
//
// Fixed key order, sorted frameworkMapping keys, so the same logical payload always produces a
// byte-identical canonical string. The CLI builds this string client-side and signs it locally;
// the backend independently reconstructs the same string server-side before verifying the
// signature (Durable Decision 10 note) -- so any divergence between the two implementations would
// make every CLI-produced signature fail server-side verification.
export interface CanonicalCheckField {
  id: string;
  dimension: string;
  title: string;
  points: number;
  earned: number;
  passed: boolean;
  evidence: string;
}

export interface CanonicalSubmissionFields {
  repoId: string;
  score: number;
  level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
  /** Omitted entirely from the canonical string when undefined -- see Durable Decision 2. */
  checks?: CanonicalCheckField[];
  frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  commitSha: string;
  scannedAt: string;
}

export function buildCanonicalPayload(f: CanonicalSubmissionFields): string {
  // Each entry is rebuilt with an explicit, fixed key order (nistFunctions, then owaspIds) --
  // never `f.frameworkMapping[k]` passed through as-is -- because a value that has round-tripped
  // through a `jsonb` database column comes back with its object keys reordered by PostgreSQL
  // (jsonb does not preserve insertion order), which would otherwise silently change the
  // canonical string and invalidate every verified-tier signature once evidence is re-fetched
  // (found during Phase 6's live end-to-end proof against a real backend).
  const sortedMapping = Object.fromEntries(
    Object.keys(f.frameworkMapping)
      .sort()
      .map((k) => [k, { nistFunctions: f.frameworkMapping[k]!.nistFunctions, owaspIds: f.frameworkMapping[k]!.owaspIds }]),
  );

  const payload: Record<string, unknown> = {
    repoId: f.repoId,
    score: f.score,
    level: { index: f.level.index, name: f.level.name },
    dimensions: f.dimensions.map((d) => ({
      id: d.id,
      title: d.title,
      earned: d.earned,
      max: d.max,
      percent: d.percent,
    })),
  };

  // Conditionally inserted (never `checks: null`/`checks: undefined`) so a submission that omits
  // checks[] entirely produces a byte-identical canonical string to the pre-extension shape --
  // JSON.stringify drops a key assigned `undefined`, but only if the key is never assigned at all
  // here (assigning `payload.checks = undefined` would still be fine for JSON.stringify's output,
  // but this `if` makes the omission explicit and testable rather than relying on that nuance).
  if (f.checks !== undefined) {
    payload.checks = f.checks.map((c) => ({
      id: c.id,
      dimension: c.dimension,
      title: c.title,
      points: c.points,
      earned: c.earned,
      passed: c.passed,
      evidence: c.evidence,
    }));
  }

  payload.frameworkMapping = sortedMapping;
  payload.commitSha = f.commitSha;
  payload.scannedAt = f.scannedAt;

  return JSON.stringify(payload);
}
