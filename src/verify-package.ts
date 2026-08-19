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
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(`${apiUrl}/submissions/${submissionId}/evidence`);
  } catch (error) {
    return { valid: false, reason: `request failed -- ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!res.ok) {
    return { valid: false, reason: res.status === 404 ? 'submission not found' : `request failed (${res.status})` };
  }
  let body: CanonicalSubmissionFields & {
    signature: string | null;
    keyId: string | null;
    publicKey: string | null;
  };
  try {
    body = (await res.json()) as CanonicalSubmissionFields & {
      signature: string | null;
      keyId: string | null;
      publicKey: string | null;
    };
  } catch {
    return { valid: false, reason: 'could not parse evidence response' };
  }
  // `res.json()` only rejects for genuinely invalid JSON syntax -- valid-but-useless JSON like the
  // literal `null` (or a JSON array/primitive) parses successfully, so it doesn't hit the catch
  // above. Guard explicitly before any property access, otherwise `body.signature` below would
  // throw a raw TypeError for a 200 OK response whose body is just `null`.
  if (body === null || typeof body !== 'object') {
    return { valid: false, reason: 'malformed evidence response' };
  }
  if (!body.signature || !body.publicKey) {
    return { valid: false, reason: 'submission is unsigned -- nothing to cryptographically verify' };
  }
  // Both the canonical-payload rebuild and the signature verification below are synchronous and
  // can throw on a 200 OK response whose JSON body doesn't actually match the expected shape --
  // buildCanonicalPayload throws (e.g. TypeError) when required fields like `frameworkMapping` or
  // `dimensions` are missing, and verifyEd25519Raw's createPublicKey throws on a malformed/
  // non-base64 `publicKey`. Neither is a "signature is invalid" outcome (which is expressed via
  // the boolean return below) -- both are "the server sent us something we can't even evaluate",
  // so they're caught here the same way the fetchImpl/res.json() steps above are: never let an
  // untrusted response crash this function.
  let valid: boolean;
  try {
    // The evidence endpoint always includes a `checks` key, `null` when the submission never
    // adopted checks[] -- normalize back to `undefined` here so buildCanonicalPayload omits the
    // key entirely (Durable Decision 2), mirroring the backend's own verifySignedSubmission
    // null-to-undefined conversion (Task 2.1).
    const canonical = buildCanonicalPayload({ ...body, checks: body.checks ?? undefined });
    valid = verifyEd25519Raw(body.publicKey, canonical, body.signature);
  } catch {
    return { valid: false, reason: 'malformed evidence response' };
  }
  return valid
    ? { valid: true }
    : { valid: false, reason: 'signature does not match the evidence payload (tampered, wrong key, or corrupted)' };
}
