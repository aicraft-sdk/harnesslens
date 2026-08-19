/**
 * Builds a signed evidence-package submission request body from a scan `Report`, for
 * `harnesslens submit --sign` (Phase 5). Uses `src/canonical-payload.ts` (this package's own
 * mirror of the backend's canonical-payload contract) to compute the exact byte string the
 * backend will independently reconstruct and verify the signature against.
 */
import { sign, type KeyObject } from 'node:crypto';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';
import type { Report } from './types.js';

export interface SignedSubmissionBody {
  repoId: string;
  score: number;
  level: { index: number; name: string };
  dimensions: CanonicalSubmissionFields['dimensions'];
  checks?: CanonicalSubmissionFields['checks'];
  frameworkMapping: CanonicalSubmissionFields['frameworkMapping'];
  commitSha: string;
  scannedAt: string;
  keyId: string;
  signature: string;
}

export interface BuildSignedSubmissionOptions {
  repoId: string;
  commitSha: string;
  keyId: string;
  privateKey: KeyObject;
  scannedAt?: string;
}

/** Maps `Report.checks[]` to the 7-field DTO shape, dropping `remediation`/`docsUrl` (Durable
 * Decision 3 -- redundant with the public checks registry), then signs the resulting canonical
 * payload with the caller's local Ed25519 private key. */
export function buildSignedSubmissionBody(report: Report, opts: BuildSignedSubmissionOptions): SignedSubmissionBody {
  const scannedAt = opts.scannedAt ?? new Date().toISOString();
  const fields: CanonicalSubmissionFields = {
    repoId: opts.repoId,
    score: report.score.percent,
    level: { index: report.level.index, name: report.level.name },
    dimensions: report.dimensions.map((d) => ({ id: d.id, title: d.title, earned: d.earned, max: d.max, percent: d.percent })),
    checks: report.checks.map((c) => ({
      id: c.id, dimension: c.dimension, title: c.title, points: c.points, earned: c.earned, passed: c.passed, evidence: c.evidence,
    })),
    frameworkMapping: report.frameworkMapping as CanonicalSubmissionFields['frameworkMapping'],
    commitSha: opts.commitSha,
    scannedAt,
  };
  const canonical = buildCanonicalPayload(fields);
  const signature = sign(null, Buffer.from(canonical, 'utf8'), opts.privateKey).toString('base64');

  return { ...fields, keyId: opts.keyId, signature };
}
