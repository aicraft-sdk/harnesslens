/**
 * `verifyPackage` -- the client-side counterpart to `harnesslens submit --sign` (Phase 5).
 * Fetches a submission's evidence from `GET /submissions/:id/evidence`, rebuilds the canonical
 * payload locally with this package's own `buildCanonicalPayload` mirror (Task 5.1), and verifies
 * the fetched `signature` against the fetched `publicKey` -- entirely independent of the backend's
 * own "signature valid" claim (that is the whole point of the design: harnesslens never asks the
 * caller to trust its own verdict). Never throws for a 404 or an unsigned submission; always
 * returns a structured `{ valid, reason }` (Critical-Path Verification Design, `verifyPackage`
 * behavior contract).
 */
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';
import { verifyEd25519Raw } from './ed25519.js';

export interface VerifyPackageResult {
  valid: boolean;
  reason?: string;
}

export async function verifyPackage(
  submissionId: string,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyPackageResult> {
  const res = await fetchImpl(`${apiUrl}/submissions/${submissionId}/evidence`);
  if (!res.ok) {
    return { valid: false, reason: res.status === 404 ? 'submission not found' : `request failed (${res.status})` };
  }
  const body = (await res.json()) as CanonicalSubmissionFields & {
    signature: string | null;
    keyId: string | null;
    publicKey: string | null;
  };
  if (!body.signature || !body.publicKey) {
    return { valid: false, reason: 'submission is unsigned -- nothing to cryptographically verify' };
  }
  // The evidence endpoint always includes a `checks` key, `null` when the submission never
  // adopted checks[] -- normalize back to `undefined` here so buildCanonicalPayload omits the
  // key entirely (Durable Decision 2), mirroring the backend's own verifySignedSubmission
  // null-to-undefined conversion (Task 2.1).
  const canonical = buildCanonicalPayload({ ...body, checks: body.checks ?? undefined });
  const valid = verifyEd25519Raw(body.publicKey, canonical, body.signature);
  return valid
    ? { valid: true }
    : { valid: false, reason: 'signature does not match the evidence payload (tampered, wrong key, or corrupted)' };
}
