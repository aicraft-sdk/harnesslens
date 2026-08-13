import { describe, it, expect, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { SubmissionsService } from './submissions.service';
import type { CreateSubmissionDto } from './dto/create-submission.dto';
import type { SigningKey } from '../signing-keys/entities/signing-key.entity';

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
  const service = new SubmissionsService(signingKeysRepoStub);

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
