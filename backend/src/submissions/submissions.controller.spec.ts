import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import type { CreateSubmissionDto } from './dto/create-submission.dto';
import type { Submission } from './entities/submission.entity';
import type { ReposService } from '../repos/repos.service';
import type { Repo } from '../repos/entities/repo.entity';
import type { SigningKey } from '../signing-keys/entities/signing-key.entity';

// These DTOs never set `keyId`, so the signing-key repository is never consulted -- stubbed only
// to satisfy SubmissionsService's constructor dependency.
const signingKeysRepoStub = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;

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

describe('SubmissionsController.create -- service-layer rejection wiring', () => {
  it('surfaces a service-originated dangerous-dimension rejection as a BadRequestException, independent of DTO-layer validation', async () => {
    // Calling controller.create() directly -- unlike a real HTTP request -- never runs
    // ValidationPipe/class-validator, so this raw payload (not plainToInstance'd, no DTO
    // validation applied) can only be caught by SubmissionsService.buildInsertableSubmission's
    // own isDangerousKey fail-closed check. This proves the "two independent layers" claim: the
    // service layer's check -- and the controller's wiring of a service `ok: false` result into a
    // BadRequestException -- work with no dependency on the DTO layer having already run.
    const dangerousDto = {
      ...validDto,
      dimensions: [{ ...validDto.dimensions[0], id: '__proto__' }],
    } as CreateSubmissionDto;
    const reposServiceStub = {
      findOrCreateForSubmission: vi.fn().mockResolvedValue({ id: repoUuid } as Repo),
    } as unknown as ReposService;
    const submissionsRepoStub = { insert: vi.fn() } as unknown as Repository<Submission>;
    const controller = new SubmissionsController(
      reposServiceStub,
      new SubmissionsService(signingKeysRepoStub),
      submissionsRepoStub,
    );

    await expect(controller.create(dangerousDto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(dangerousDto)).rejects.toThrow(
      'dimensions contains a dangerous key: __proto__',
    );
    expect(submissionsRepoStub.insert).not.toHaveBeenCalled();
  });

  it('never calls reposService.findOrCreateForSubmission when service-layer validation rejects the submission (no orphaned accounts/repos row on a validation failure)', async () => {
    const dangerousDto = {
      ...validDto,
      dimensions: [{ ...validDto.dimensions[0], id: '__proto__' }],
    } as CreateSubmissionDto;
    const findOrCreateSpy = vi.fn().mockResolvedValue({ id: repoUuid } as Repo);
    const reposServiceStub = { findOrCreateForSubmission: findOrCreateSpy } as unknown as ReposService;
    const submissionsRepoStub = { insert: vi.fn() } as unknown as Repository<Submission>;
    const controller = new SubmissionsController(
      reposServiceStub,
      new SubmissionsService(signingKeysRepoStub),
      submissionsRepoStub,
    );

    await expect(controller.create(dangerousDto)).rejects.toBeInstanceOf(BadRequestException);

    expect(findOrCreateSpy).not.toHaveBeenCalled();
  });
});
