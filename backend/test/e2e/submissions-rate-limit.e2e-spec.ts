import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { Account } from '../../src/accounts/entities/account.entity';
import { SigningKey } from '../../src/signing-keys/entities/signing-key.entity';
import { Repo } from '../../src/repos/entities/repo.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { RejectedSubmission } from '../../src/submissions/entities/rejected-submission.entity';
import { InitSchema1786633235167 } from '../../src/migrations/1786633235167-InitSchema';
import { AddChecksToSubmissions1787126020558 } from '../../src/migrations/1787126020558-AddChecksToSubmissions';
import { createGlobalValidationPipe } from '../../src/common/validation-pipe.factory';

const validPayload = {
  repoId: 'acme/rate-limit-widgets',
  score: 50,
  level: { index: 1, name: 'L1' },
  dimensions: [],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  process.env.SUBMIT_RATE_LIMIT_PER_MIN = '5';
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const migrationDs = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
    migrations: [InitSchema1786633235167, AddChecksToSubmissions1787126020558],
  });
  await migrationDs.initialize();
  await migrationDs.runMigrations();
  await migrationDs.destroy();
}, 60_000);

afterAll(async () => {
  await container.stop();
  delete process.env.SUBMIT_RATE_LIMIT_PER_MIN;
});

describe('POST /submissions rate limiting', () => {
  it('returns 429 after exceeding SUBMIT_RATE_LIMIT_PER_MIN requests from one IP, without auditing the 429 as a rejected submission', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    const dataSource = moduleRef.get(DataSource);
    const rejectedRepo = dataSource.getRepository(RejectedSubmission);

    const limit = Number(process.env.SUBMIT_RATE_LIMIT_PER_MIN ?? 30);
    for (let i = 0; i < limit; i++) {
      await request(app.getHttpServer()).post('/submissions').send(validPayload);
    }
    const rejectedCountBefore429 = await rejectedRepo.count();
    await request(app.getHttpServer()).post('/submissions').send(validPayload).expect(429);

    // Rate limiting exists to protect the DB from abuse-volume load -- auditing every 429 would
    // defeat that purpose, so the rejected_submissions count must be unchanged by the 429 itself.
    expect(await rejectedRepo.count()).toBe(rejectedCountBefore429);

    await app.close();
  });
});
