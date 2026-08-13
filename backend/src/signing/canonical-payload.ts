// Server-reconstructed only, per Durable Decision 10: the server never accepts a "canonical
// string" as request input. It always rebuilds this exact canonical JSON string itself from
// already-validated, already-field-by-field-reconstructed submission fields before verifying a
// signature against it -- a client cannot lie about what it "meant" to sign. Fixed key order,
// sorted frameworkMapping keys, so the same logical payload always produces a byte-identical
// canonical string.
export interface CanonicalSubmissionFields {
  repoId: string;
  score: number;
  level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
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
  return JSON.stringify({
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
    frameworkMapping: sortedMapping,
    commitSha: f.commitSha,
    scannedAt: f.scannedAt,
  });
}
