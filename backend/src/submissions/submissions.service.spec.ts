import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { SubmissionsService } from './submissions.service';
import type { CreateSubmissionDto } from './dto/create-submission.dto';
import type { SigningKey } from '../signing-keys/entities/signing-key.entity';
import type { ReposService } from '../repos/repos.service';
import type { Repo } from '../repos/entities/repo.entity';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from '../signing/canonical-payload';

const validDto: CreateSubmissionDto = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
} as CreateSubmissionDto;

describe('SubmissionsService.buildInsertableSubmission', () => {
  // Basic-tier DTOs used throughout this file never set `keyId`, so the signing-key repository is
  // never consulted -- stubbed only to satisfy the constructor's dependency.
  const signingKeysRepoStub = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
  const reposServiceStub = { findOrCreateForSubmission: vi.fn() } as unknown as ReposService;
  const service = new SubmissionsService(signingKeysRepoStub, reposServiceStub);

  it('builds an insertable row field-by-field for a valid submission', async () => {
    const result = await service.buildInsertableSubmission(validDto);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row).toEqual({
        score: String(validDto.score),
        level: validDto.level,
        dimensions: validDto.dimensions,
        frameworkMapping: {},
        commitSha: validDto.commitSha,
        scannedAt: new Date(validDto.scannedAt),
        verified: false,
        signature: null,
        keyId: null,
      });
    }
  });

  it('rejects a submission with a dangerous dimension id (fail-closed)', async () => {
    const dto = {
      ...validDto,
      dimensions: [{ ...validDto.dimensions[0], id: '__proto__' }],
    } as CreateSubmissionDto;
    const result = await service.buildInsertableSubmission(dto);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(
      'dimensions contains a dangerous key: __proto__',
    );
  });

  it('rejects a frameworkMapping key of "__proto__" without throwing/polluting the prototype', async () => {
    // Computed property syntax creates a genuine own property named "__proto__" (bypassing the
    // object-literal special case that would otherwise set the object's actual prototype).
    const dangerousMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }> = {
      ['__proto__']: { nistFunctions: ['GOVERN'], owaspIds: [] },
    };
    const dto = { ...validDto, frameworkMapping: dangerousMapping } as CreateSubmissionDto;
    const result = await service.buildInsertableSubmission(dto);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.frameworkMapping).toEqual({});
    }
    expect((Object.prototype as unknown as { nistFunctions?: unknown }).nistFunctions).toBeUndefined();
  });

  it('drops a single dangerous frameworkMapping entry but keeps the rest (fail-open)', async () => {
    const dto = {
      ...validDto,
      frameworkMapping: {
        constructor: { nistFunctions: ['GOVERN'], owaspIds: [] },
        ci: { nistFunctions: ['PROTECT'], owaspIds: ['A01'] },
      },
    } as unknown as CreateSubmissionDto;
    const result = await service.buildInsertableSubmission(dto);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.frameworkMapping).toEqual({
        ci: { nistFunctions: ['PROTECT'], owaspIds: ['A01'] },
      });
    }
  });

  it('drops a frameworkMapping entry with a malformed shape (nistFunctions/owaspIds not arrays) but keeps well-formed entries (fail-open)', async () => {
    const dto = {
      ...validDto,
      frameworkMapping: {
        ci: {}, // malformed: no nistFunctions/owaspIds at all
        security: { nistFunctions: ['PROTECT'], owaspIds: ['A01'] },
      },
    } as unknown as CreateSubmissionDto;
    const result = await service.buildInsertableSubmission(dto);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.frameworkMapping).toEqual({
        security: { nistFunctions: ['PROTECT'], owaspIds: ['A01'] },
      });
    }
  });

  it('never spreads the raw DTO into the insert row -- constructs field-by-field', async () => {
    const dto = { ...validDto, maliciousExtra: 'should never appear' } as unknown as CreateSubmissionDto;
    const result = await service.buildInsertableSubmission(dto);
    expect(result.ok).toBe(true);
    expect(result.ok && (result.row as unknown as { maliciousExtra?: unknown }).maliciousExtra).toBeUndefined();
  });
});

function rawPublicKeyBase64(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function signDto(privateKey: KeyObject, dto: CreateSubmissionDto): string {
  const fields: CanonicalSubmissionFields = {
    repoId: dto.repoId,
    score: dto.score,
    level: dto.level,
    dimensions: dto.dimensions,
    frameworkMapping: dto.frameworkMapping,
    commitSha: dto.commitSha,
    scannedAt: dto.scannedAt,
  };
  const canonical = buildCanonicalPayload(fields);
  return sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
}

describe('SubmissionsService.buildInsertableSubmission -- verified-tier signature verification', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBase64 = rawPublicKeyBase64(publicKey);

  it('rejects a genuinely valid signature when the signing key belongs to a different account than the one that owns the repo (cross-account key binding)', async () => {
    const signedDto: CreateSubmissionDto = { ...validDto, keyId: 'key-1', signature: '' } as CreateSubmissionDto;
    signedDto.signature = signDto(privateKey, signedDto);

    const signingKeysRepoStub = {
      findOneBy: vi.fn().mockResolvedValue({
        keyId: 'key-1',
        accountId: 'account-that-owns-the-key',
        publicKey: publicKeyBase64,
        revokedAt: null,
      } as SigningKey),
    } as unknown as Repository<SigningKey>;
    // The repo's *actual* owning account is different from the signing key's account -- this is
    // the exact cross-tenant forgery this check must block, even though the signature itself is
    // cryptographically valid over the correct payload.
    const reposServiceStub = {
      findOrCreateForSubmission: vi
        .fn()
        .mockResolvedValue({ id: 'repo-uuid', accountId: 'a-different-account-entirely' } as Repo),
    } as unknown as ReposService;
    const service = new SubmissionsService(signingKeysRepoStub, reposServiceStub);

    const result = await service.buildInsertableSubmission(signedDto);

    expect(result.ok).toBe(false);
    // Same generic reason as every other verification failure -- oracle-prevention discipline:
    // an account-mismatch rejection must be indistinguishable from any other invalid-signature
    // rejection (unknown key, revoked key, bad signature).
    expect(result.ok === false && result.reason).toBe('invalid signature');
  });

  it('accepts a genuinely valid signature when the signing key belongs to the same account that owns the repo', async () => {
    const signedDto: CreateSubmissionDto = { ...validDto, keyId: 'key-1', signature: '' } as CreateSubmissionDto;
    signedDto.signature = signDto(privateKey, signedDto);

    const signingKeysRepoStub = {
      findOneBy: vi.fn().mockResolvedValue({
        keyId: 'key-1',
        accountId: 'shared-account',
        publicKey: publicKeyBase64,
        revokedAt: null,
      } as SigningKey),
    } as unknown as Repository<SigningKey>;
    const reposServiceStub = {
      findOrCreateForSubmission: vi
        .fn()
        .mockResolvedValue({ id: 'repo-uuid', accountId: 'shared-account' } as Repo),
    } as unknown as ReposService;
    const service = new SubmissionsService(signingKeysRepoStub, reposServiceStub);

    const result = await service.buildInsertableSubmission(signedDto);

    expect(result.ok).toBe(true);
    expect(result.ok && result.row.verified).toBe(true);
  });

  it('does not throw when the stored signing key has a garbage/wrong-length publicKey -- fails closed cleanly instead of crashing (defensive regression guard)', async () => {
    const signedDto: CreateSubmissionDto = {
      ...validDto,
      keyId: 'key-1',
      signature: 'AAAAAAAAAAAAAAAAAAAA',
    } as CreateSubmissionDto;

    const signingKeysRepoStub = {
      findOneBy: vi.fn().mockResolvedValue({
        keyId: 'key-1',
        accountId: 'shared-account',
        publicKey: 'not-a-valid-32-byte-ed25519-key', // garbage/wrong-length
        revokedAt: null,
      } as SigningKey),
    } as unknown as Repository<SigningKey>;
    // Same account as the repo -- isolates this test to the publicKey-parsing crash path, not the
    // account-binding check above.
    const reposServiceStub = {
      findOrCreateForSubmission: vi
        .fn()
        .mockResolvedValue({ id: 'repo-uuid', accountId: 'shared-account' } as Repo),
    } as unknown as ReposService;
    const service = new SubmissionsService(signingKeysRepoStub, reposServiceStub);

    await expect(service.buildInsertableSubmission(signedDto)).resolves.toEqual({
      ok: false,
      reason: 'invalid signature',
    });
  });
});
