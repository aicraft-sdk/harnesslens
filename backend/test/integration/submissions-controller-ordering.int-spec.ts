import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, type Repository } from 'typeorm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Account } from '../../src/accounts/entities/account.entity';
import { SigningKey } from '../../src/signing-keys/entities/signing-key.entity';
import { Repo } from '../../src/repos/entities/repo.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { RejectedSubmission } from '../../src/submissions/entities/rejected-submission.entity';
import { InitSchema1786633235167 } from '../../src/migrations/1786633235167-InitSchema';
import { AddChecksToSubmissions1787126020558 } from '../../src/migrations/1787126020558-AddChecksToSubmissions';
import { ReposService } from '../../src/repos/repos.service';
import { SubmissionsService } from '../../src/submissions/submissions.service';
import { SubmissionsController } from '../../src/submissions/submissions.controller';
import type { SubmissionEvidenceService } from '../../src/submissions/submission-evidence.service';
import type { CreateSubmissionDto } from '../../src/submissions/dto/create-submission.dto';

// This spec only exercises controller.create() -- the evidence service is never called on that
// path, so a stub satisfies the constructor without wiring a real SubmissionEvidenceService.
const evidenceServiceStub = {} as unknown as SubmissionEvidenceService;

const validDto = {
  repoId: 'acme/no-orphan-widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
} as CreateSubmissionDto;

describe('SubmissionsController.create -- validation runs before repo auto-provisioning', () => {
  let container: StartedPostgreSqlContainer;
  let ds: DataSource;
  let reposRepo: Repository<Repo>;
  let accountsRepo: Repository<Account>;
  let controller: SubmissionsController;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    ds = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
      migrations: [InitSchema1786633235167, AddChecksToSubmissions1787126020558],
    });
    await ds.initialize();
    await ds.runMigrations();
    accountsRepo = ds.getRepository(Account);
    reposRepo = ds.getRepository(Repo);
    const reposService = new ReposService(accountsRepo, reposRepo);
    controller = new SubmissionsController(
      reposService,
      new SubmissionsService(ds.getRepository(SigningKey), accountsRepo, reposRepo),
      ds.getRepository(Submission),
      evidenceServiceStub,
    );
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
    await container.stop();
  });

  it('leaves no accounts/repos row for a repoId whose submission is rejected for a dangerous dimension key', async () => {
    // Calling controller.create() directly (not via HTTP/ValidationPipe) proves the ordering fix
    // at the controller level: `buildInsertableSubmission` must reject this dangerous-key payload
    // before `findOrCreateForSubmission` is ever reached.
    const dangerousDto = {
      ...validDto,
      dimensions: [{ ...validDto.dimensions[0], id: '__proto__' }],
    } as CreateSubmissionDto;

    await expect(controller.create(dangerousDto)).rejects.toBeInstanceOf(BadRequestException);

    expect(await reposRepo.findOneBy({ repoId: dangerousDto.repoId })).toBeNull();
    expect(await accountsRepo.findOneBy({ orgName: dangerousDto.repoId.split('/')[0] })).toBeNull();
  });
});
