import { describe, expect, it } from 'vitest';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload';
import { verifyEd25519 } from './ed25519';

// Fixed, checked-in test keypair generated once via node:crypto (ed25519). Neither private key is
// stored anywhere -- only the raw 32-byte public keys (base64) and a signature produced offline
// against the fixed fixture below are hardcoded here, matching how a real signing_keys.public_key
// row and a real submission signature would look on the wire.
const fields: CanonicalSubmissionFields = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {
    nist: { nistFunctions: ['ID.AM'], owaspIds: ['A01'] },
    owasp: { nistFunctions: [], owaspIds: ['A02'] },
  },
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

const EXPECTED_FIXTURE_CANONICAL_STRING =
  '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],"frameworkMapping":{"nist":{"nistFunctions":["ID.AM"],"owaspIds":["A01"]},"owasp":{"nistFunctions":[],"owaspIds":["A02"]}},"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}';

const publicKeyBase64 = 'QIzp4l41mSRXOuI9o/eZsymtnu0iJx9mcQyXpaOGkws=';
const wrongPublicKeyBase64 = 'NtYUULHubzySMgHgx0/gKWoJWB344vD2cMrMFvRYqpg=';
const validSignatureBase64 =
  'udTuaDJ1yV/bg3dq3ob4VUmGxogzC4Qg/RtzMZDlt5vgTUw8/RmkakWtbno4khSrnE87zAMbvgUt7WMl2Uu6CA==';

describe('verifyEd25519', () => {
  it('verifies a valid signature over the canonical payload', () => {
    expect(verifyEd25519(publicKeyBase64, buildCanonicalPayload(fields), validSignatureBase64)).toBe(true);
  });

  it('rejects a signature over a tampered payload (score changed by 0.1)', () => {
    const tampered = buildCanonicalPayload({ ...fields, score: fields.score + 0.1 });
    expect(verifyEd25519(publicKeyBase64, tampered, validSignatureBase64)).toBe(false);
  });

  it('rejects a well-formed but wrong-key signature', () => {
    expect(verifyEd25519(wrongPublicKeyBase64, buildCanonicalPayload(fields), validSignatureBase64)).toBe(false);
  });

  it('the fixed fixture vector produces a byte-identical canonical string every run (determinism check)', () => {
    expect(buildCanonicalPayload(fields)).toBe(EXPECTED_FIXTURE_CANONICAL_STRING);
  });
});
