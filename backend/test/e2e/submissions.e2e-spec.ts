import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { Account } from '../../src/accounts/entities/account.entity';
import { SigningKey } from '../../src/signing-keys/entities/signing-key.entity';
import { Repo } from '../../src/repos/entities/repo.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { RejectedSubmission } from '../../src/submissions/entities/rejected-submission.entity';
import { InitSchema1786633235167 } from '../../src/migrations/1786633235167-InitSchema';
import { createGlobalValidationPipe } from '../../src/common/validation-pipe.factory';

const validPayload = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const migrationDs = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
    migrations: [InitSchema1786633235167],
  });
  await migrationDs.initialize();
  await migrationDs.runMigrations();
  await migrationDs.destroy();
}, 60_000);

afterAll(async () => {
  await container.stop();
});

describe('POST /submissions', () => {
  let app: import('@nestjs/common').INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Each test starts from a clean slate for the two audited/insert-only tables so exact-count
    // assertions below aren't affected by earlier tests sharing the same Testcontainers Postgres.
    await dataSource.query('TRUNCATE TABLE submissions, rejected_submissions RESTART IDENTITY CASCADE');
  });

  it('with a valid basic-tier payload -> 201, persisted, verified: false', async () => {
    const res = await request(app.getHttpServer()).post('/submissions').send(validPayload).expect(201);
    expect(res.body).toMatchObject({ verified: false });
    const submissionsRepo = dataSource.getRepository(Submission);
    const row = await submissionsRepo.findOneBy({ id: res.body.id });
    expect(row?.repoId).toBeDefined();
  });

  it('with an extra top-level field -> 400, nothing persisted, audit row recorded', async () => {
    await request(app.getHttpServer()).post('/submissions').send({ ...validPayload, extra: 'x' }).expect(400);
    const submissionsRepo = dataSource.getRepository(Submission);
    const rejectedRepo = dataSource.getRepository(RejectedSubmission);
    expect(await submissionsRepo.count()).toBe(0);
    expect(await rejectedRepo.count()).toBe(1);
  });

  it('with malformed payload -> 400 AND a rejected_submissions audit row', async () => {
    await request(app.getHttpServer()).post('/submissions').send({ repoId: 'bad shape' }).expect(400);
    const rejectedRepo = dataSource.getRepository(RejectedSubmission);
    expect(await rejectedRepo.count()).toBe(1);
  });

  it('rejects a submission with a "__proto__" dimension id -> 400 with an audit row, nothing persisted', async () => {
    const payload = {
      ...validPayload,
      dimensions: [{ ...validPayload.dimensions[0], id: '__proto__' }],
    };
    await request(app.getHttpServer()).post('/submissions').send(payload).expect(400);
    const submissionsRepo = dataSource.getRepository(Submission);
    const rejectedRepo = dataSource.getRepository(RejectedSubmission);
    expect(await submissionsRepo.count()).toBe(0);
    expect(await rejectedRepo.count()).toBe(1);
  });

  it('with a score that passes DTO validation but overflows the numeric(5,2) column at insert -> 500, audited with a structured reason, nothing persisted', async () => {
    // -1000 passes @IsNumber/@Max(999.99) (no lower bound is enforced at the DTO layer) but its
    // magnitude exceeds numeric(5,2)'s representable range, so it fails only once TypeORM issues
    // the INSERT -- a genuine non-BadRequestException failure the audit filter must still catch.
    const res = await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...validPayload, score: -1000 })
      .expect(500);
    expect(res.body).toMatchObject({ statusCode: 500 });
    const submissionsRepo = dataSource.getRepository(Submission);
    const rejectedRepo = dataSource.getRepository(RejectedSubmission);
    expect(await submissionsRepo.count()).toBe(0);
    const rejectedRows = await rejectedRepo.find();
    expect(rejectedRows).toHaveLength(1);
    expect(rejectedRows[0]?.reason).toMatch(/numeric field overflow/i);
  });
});
