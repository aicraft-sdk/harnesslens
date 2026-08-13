import { describe, it, expect } from 'vitest';
import { SubmissionsService } from './submissions.service';
import type { CreateSubmissionDto } from './dto/create-submission.dto';

const repoUuid = '11111111-1111-1111-1111-111111111111';

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
  const service = new SubmissionsService();

  it('builds an insertable row field-by-field for a valid submission', () => {
    const result = service.buildInsertableSubmission(validDto, repoUuid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row).toEqual({
        repoId: repoUuid,
        score: validDto.score,
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

  it('rejects a submission with a dangerous dimension id (fail-closed)', () => {
    const dto = {
      ...validDto,
      dimensions: [{ ...validDto.dimensions[0], id: '__proto__' }],
    } as CreateSubmissionDto;
    const result = service.buildInsertableSubmission(dto, repoUuid);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(
      'dimensions contains a dangerous key: __proto__',
    );
  });

  it('rejects a frameworkMapping key of "__proto__" without throwing/polluting the prototype', () => {
    // Computed property syntax creates a genuine own property named "__proto__" (bypassing the
    // object-literal special case that would otherwise set the object's actual prototype).
    const dangerousMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }> = {
      ['__proto__']: { nistFunctions: ['GOVERN'], owaspIds: [] },
    };
    const dto = { ...validDto, frameworkMapping: dangerousMapping } as CreateSubmissionDto;
    const result = service.buildInsertableSubmission(dto, repoUuid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.frameworkMapping).toEqual({});
    }
    expect((Object.prototype as unknown as { nistFunctions?: unknown }).nistFunctions).toBeUndefined();
  });

  it('drops a single dangerous frameworkMapping entry but keeps the rest (fail-open)', () => {
    const dto = {
      ...validDto,
      frameworkMapping: {
        constructor: { nistFunctions: ['GOVERN'], owaspIds: [] },
        ci: { nistFunctions: ['PROTECT'], owaspIds: ['A01'] },
      },
    } as unknown as CreateSubmissionDto;
    const result = service.buildInsertableSubmission(dto, repoUuid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.frameworkMapping).toEqual({
        ci: { nistFunctions: ['PROTECT'], owaspIds: ['A01'] },
      });
    }
  });

  it('never spreads the raw DTO into the insert row -- constructs field-by-field', () => {
    const dto = { ...validDto, maliciousExtra: 'should never appear' } as unknown as CreateSubmissionDto;
    const result = service.buildInsertableSubmission(dto, repoUuid);
    expect(result.ok).toBe(true);
    expect(result.ok && (result.row as unknown as { maliciousExtra?: unknown }).maliciousExtra).toBeUndefined();
  });
});
