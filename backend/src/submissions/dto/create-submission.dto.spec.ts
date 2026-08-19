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

  it('rejects an extra top-level field via whitelist/forbidNonWhitelisted (same mechanism the ValidationPipe uses)', async () => {
    const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, extra: 'nope' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a dimension with id "__proto__"', async () => {
    const dto = plainToInstance(CreateSubmissionDto, {
      ...validPayload,
      dimensions: [{ ...validPayload.dimensions[0], id: '__proto__' }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a score above the numeric(5,2) column max of 999.99', async () => {
    const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, score: 1000 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  const checksPayload = [
    {
      id: 'CTX-01',
      dimension: 'context',
      title: 'Has AGENTS.md',
      points: 5,
      earned: 5,
      passed: true,
      evidence: 'Found AGENTS.md at repo root',
    },
  ];

  it('accepts a valid payload with checks[]', async () => {
    const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, checks: checksPayload });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a payload with no checks[] at all (checks stays optional)', async () => {
    const dto = plainToInstance(CreateSubmissionDto, validPayload);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a check with id "__proto__"', async () => {
    const dto = plainToInstance(CreateSubmissionDto, {
      ...validPayload,
      checks: [{ ...checksPayload[0], id: '__proto__' }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a check missing the required "passed" boolean', async () => {
    const { passed, ...withoutPassed } = checksPayload[0]!;
    const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, checks: [withoutPassed] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
