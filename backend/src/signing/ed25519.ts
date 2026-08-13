import { createPublicKey, verify } from 'node:crypto';

// Ed25519 keys are exchanged as base64-encoded raw 32-byte public keys and base64-encoded raw
// 64-byte signatures (Durable Decision 9). Verification uses Node's native crypto.verify with the
// public key reconstructed via a JWK ({ kty: 'OKP', crv: 'Ed25519', x: <base64url> }) KeyObject --
// no third-party signing library.
export function verifyEd25519(publicKeyBase64: string, payload: string, signatureBase64: string): boolean {
  const x = Buffer.from(publicKeyBase64, 'base64').toString('base64url');
  const keyObject = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
  return verify(null, Buffer.from(payload, 'utf8'), keyObject, Buffer.from(signatureBase64, 'base64'));
}
