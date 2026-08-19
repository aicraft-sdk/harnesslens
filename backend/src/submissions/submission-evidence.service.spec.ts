import { describe, it, expect, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { SubmissionEvidenceService } from './submission-evidence.service';
import type { Submission } from './entities/submission.entity';
import type { SigningKey } from '../signing-keys/entities/signing-key.entity';

// getEvidence's :id argument must be a real UUID to pass the isUUID short-circuit (Durable
// Decision 8) -- the stub's own entity `id` field is separately what the service echoes back in
// its response, and can stay a readable fixture value.
const SUB_UUID = '11111111-1111-4111-8111-111111111111';

function stubSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'sub-1', repoId: 'repo-uuid',
    repo: { id: 'repo-uuid', repoId: 'acme/widgets', accountId: 'acc-1', visibility: 'public' },
    score: '82.50', level: { index: 3, name: 'L3' }, dimensions: [], checks: null,
    frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: new Date('2026-08-13T00:00:00.000Z'),
    verified: false, signature: null, keyId: null, submittedAt: new Date(),
    ...overrides,
  } as unknown as Submission;
}

describe('SubmissionEvidenceService.getEvidence', () => {
  it('returns an explicit field-whitelisted shape for a public submission (no raw entity leak)', async () => {
    const submissionsRepo = { findOne: vi.fn().mockResolvedValue(stubSubmission()) } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);

    const result = await svc.getEvidence(SUB_UUID, undefined);

    expect(result).toEqual({
      id: 'sub-1', repoId: 'acme/widgets', score: 82.5, level: { index: 3, name: 'L3' },
      dimensions: [], checks: null, frameworkMapping: {}, commitSha: 'a1b2c3d',
      scannedAt: '2026-08-13T00:00:00.000Z', verified: false, signature: null, keyId: null,
      publicKey: null,
    });
  });

  it('includes the registered public key for a verified submission', async () => {
    const submissionsRepo = {
      findOne: vi.fn().mockResolvedValue(stubSubmission({ verified: true, signature: 'sig', keyId: 'key-1' })),
    } as unknown as Repository<Submission>;
    const signingKeysRepo = {
      findOneBy: vi.fn().mockResolvedValue({ keyId: 'key-1', publicKey: 'base64pubkey' }),
    } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);

    const result = await svc.getEvidence(SUB_UUID, undefined);
    expect(result?.publicKey).toBe('base64pubkey');
  });

  it('returns null for an unknown submission id', async () => {
    const submissionsRepo = { findOne: vi.fn().mockResolvedValue(null) } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence('99999999-9999-4999-8999-999999999999', undefined)).toBeNull();
  });

  it('returns null (not the evidence) for a private repo when the requesting account does not own it', async () => {
    const submissionsRepo = {
      findOne: vi.fn().mockResolvedValue(stubSubmission({ repo: { id: 'repo-uuid', repoId: 'acme/widgets', accountId: 'owner-account', visibility: 'private' } as never })),
    } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence(SUB_UUID, 'a-different-account')).toBeNull();
  });

  it('returns the evidence for a private repo when the requesting account IS the owner', async () => {
    const submissionsRepo = {
      findOne: vi.fn().mockResolvedValue(stubSubmission({ repo: { id: 'repo-uuid', repoId: 'acme/widgets', accountId: 'owner-account', visibility: 'private' } as never })),
    } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence(SUB_UUID, 'owner-account')).not.toBeNull();
  });

  it('returns null (never throws/500s) for a malformed, non-UUID submission id', async () => {
    const submissionsRepo = { findOne: vi.fn() } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence('not-a-uuid', undefined)).toBeNull();
    expect(submissionsRepo.findOne).not.toHaveBeenCalled();
  });
});
