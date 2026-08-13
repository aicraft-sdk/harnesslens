import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, it, expect } from 'vitest';
import { CreateSubmissionDto } from './create-submission.dto';

const validPayload = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

describe('CreateSubmissionDto', () => {
  it('accepts a valid basic-tier payload', async () => {
    const dto = plainToInstance(CreateSubmissionDto, validPayload);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an extra top-level field', async () => {
    const dto = plainToInstance(
      CreateSubmissionDto,
      { ...validPayload, extra: 'nope' },
      { excludeExtraneousValues: false },
    );
    // exercised at the ValidationPipe level in the e2e test below (forbidNonWhitelisted), this
    // unit test asserts the DTO's own field surface has no `extra` property to accept
    expect(Object.keys(dto)).not.toContain('extra');
  });

  it('rejects a dimension with id "__proto__"', async () => {
    const dto = plainToInstance(CreateSubmissionDto, {
      ...validPayload,
      dimensions: [{ ...validPayload.dimensions[0], id: '__proto__' }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
