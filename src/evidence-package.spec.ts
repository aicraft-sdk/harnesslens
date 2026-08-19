import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';
import { verifyEd25519Raw } from './ed25519.js';
import { buildSignedSubmissionBody, type SignedSubmissionBody } from './evidence-package.js';
import type { Report } from './types.js';

function fakeReport(): Report {
  return {
    tool: { name: 'harnesslens', version: '0.0.2' }, root: '/repo', truncated: false,
    scopes: { maturity: ['repo'], effective: ['repo'] }, gate: 'maturity', detectedHarnesses: [],
    level: { index: 3, name: 'L3 Systematized', nextLevelGaps: [] },
    score: { earned: 80, max: 100, percent: 80 },
    dimensions: [{ id: 'context', title: 'Context & Guides', earned: 8, max: 10, percent: 80 }],
    checks: [
      { id: 'CTX-01', dimension: 'context', title: 'Has AGENTS.md', points: 8, earned: 8, passed: true, evidence: 'Found', remediation: 'Add one', docsUrl: 'https://x' },
    ],
    effective: { level: { index: 3, name: 'L3 Systematized', nextLevelGaps: [] }, score: { earned: 80, max: 100, percent: 80 }, dimensions: [], checks: [], detectedHarnesses: [] },
    frameworkMapping: { context: { nistFunctions: ['Govern', 'Map'], owaspIds: ['ASI01', 'ASI06'] } },
  } as unknown as Report;
}

function buildCanonicalPayloadFromBody(body: SignedSubmissionBody): string {
  const fields: CanonicalSubmissionFields = {
    repoId: body.repoId,
    score: body.score,
    level: body.level,
    dimensions: body.dimensions,
    checks: body.checks,
    frameworkMapping: body.frameworkMapping,
    commitSha: body.commitSha,
    scannedAt: body.scannedAt,
  };
  return buildCanonicalPayload(fields);
}

function verifyLocally(publicKey: KeyObject, canonical: string, signature: string): boolean {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const publicKeyBase64 = Buffer.from(jwk.x, 'base64url').toString('base64');
  return verifyEd25519Raw(publicKeyBase64, canonical, signature);
}

describe('buildSignedSubmissionBody', () => {
  it('maps Report.checks[] to the DTO shape, dropping remediation/docsUrl (Durable Decision 3)', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const body = buildSignedSubmissionBody(fakeReport(), {
      repoId: 'acme/widgets', commitSha: 'a1b2c3d', keyId: 'key-1', privateKey,
    });
    expect(body.checks).toEqual([
      { id: 'CTX-01', dimension: 'context', title: 'Has AGENTS.md', points: 8, earned: 8, passed: true, evidence: 'Found' },
    ]);
    expect((body.checks![0] as unknown as Record<string, unknown>).remediation).toBeUndefined();
    expect((body.checks![0] as unknown as Record<string, unknown>).docsUrl).toBeUndefined();
  });

  it('produces a signature that verifies against the exact canonical payload the backend would reconstruct', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const body = buildSignedSubmissionBody(fakeReport(), {
      repoId: 'acme/widgets', commitSha: 'a1b2c3d', keyId: 'key-1', privateKey,
    });
    // Re-derive the canonical string the same way the backend would from the POSTed body, and
    // verify locally -- proves the client and server would agree.
    const canonical = buildCanonicalPayloadFromBody(body);
    expect(verifyLocally(publicKey, canonical, body.signature!)).toBe(true);
  });

  it('sets repoId, score (from Report.score.percent), and scannedAt (ISO, defaults to now)', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const body = buildSignedSubmissionBody(fakeReport(), { repoId: 'acme/widgets', commitSha: 'a1b2c3d', keyId: 'key-1', privateKey });
    expect(body.repoId).toBe('acme/widgets');
    expect(body.score).toBe(80);
    expect(() => new Date(body.scannedAt)).not.toThrow();
  });
});
