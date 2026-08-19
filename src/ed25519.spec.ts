import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';
import { verifyEd25519Raw } from './ed25519.js';

// Self-contained golden sign->verify round trip (no backend import possible -- same duplication
// rationale as canonical-payload.ts, Durable Decision 12). Generates a fresh Ed25519 keypair with
// node:crypto, signs a canonical payload locally, and verifies it with this module's own
// verifyEd25519Raw -- proving the CLI's sign side and verify side agree with each other, matching
// how the CLI signs a submission and how a third party (or the backend) would later verify it.
const fields: CanonicalSubmissionFields = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

function rawPublicKeyBase64FromJwk(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

describe('verifyEd25519Raw', () => {
  it('verifies a signature produced locally over the canonical payload', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const canonical = buildCanonicalPayload(fields);
    const signatureBase64 = sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');

    expect(verifyEd25519Raw(rawPublicKeyBase64FromJwk(publicKey), canonical, signatureBase64)).toBe(true);
  });

  it('rejects a signature over a tampered payload', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const canonical = buildCanonicalPayload(fields);
    const signatureBase64 = sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
    const tampered = buildCanonicalPayload({ ...fields, score: fields.score + 0.1 });

    expect(verifyEd25519Raw(rawPublicKeyBase64FromJwk(publicKey), tampered, signatureBase64)).toBe(false);
  });

  it('rejects a well-formed signature verified against the wrong public key', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const { publicKey: wrongPublicKey } = generateKeyPairSync('ed25519');
    const canonical = buildCanonicalPayload(fields);
    const signatureBase64 = sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');

    expect(verifyEd25519Raw(rawPublicKeyBase64FromJwk(wrongPublicKey), canonical, signatureBase64)).toBe(false);
  });
});
