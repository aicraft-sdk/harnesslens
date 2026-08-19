import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyPackage } from './verify-package.js';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';

function rawPublicKeyBase64(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

describe('verifyPackage', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const fields: CanonicalSubmissionFields = {
    repoId: 'acme/widgets', score: 80, level: { index: 3, name: 'L3' },
    dimensions: [], frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: '2026-08-13T00:00:00.000Z',
  };
  const signature = sign(null, Buffer.from(buildCanonicalPayload(fields), 'utf8'), privateKey).toString('base64');

  it('reports valid: true for a genuinely matching signature + payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...fields, id: 'sub-1', verified: true, signature, keyId: 'key-1', publicKey: rawPublicKeyBase64(publicKey), checks: null }),
    });
    const result = await verifyPackage('sub-1', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(true);
  });

  it('reports valid: false when the evidence has been tampered with post-signing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...fields, commitSha: 'TAMPERED', id: 'sub-1', verified: true, signature, keyId: 'key-1', publicKey: rawPublicKeyBase64(publicKey), checks: null }),
    });
    const result = await verifyPackage('sub-1', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(false);
  });

  it('reports valid: false (never throws) when the submission is unsigned (no signature/publicKey at all)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...fields, id: 'sub-1', verified: false, signature: null, keyId: null, publicKey: null, checks: null }),
    });
    const result = await verifyPackage('sub-1', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unsigned/i);
  });

  it('surfaces a 404 as a clear not-found result, not a thrown error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await verifyPackage('does-not-exist', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });
});
