// Server-reconstructed only, per Durable Decision 10: the server never accepts a "canonical
// string" as request input. It always rebuilds this exact canonical JSON string itself from
// already-validated, already-field-by-field-reconstructed submission fields before verifying a
// signature against it -- a client cannot lie about what it "meant" to sign. Fixed key order,
// sorted frameworkMapping keys, so the same logical payload always produces a byte-identical
// canonical string.
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
  const sortedMapping = Object.fromEntries(
    Object.keys(f.frameworkMapping)
      .sort()
      .map((k) => [k, f.frameworkMapping[k]]),
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
