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

describe('POST /accounts', () => {
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
    await dataSource.query('TRUNCATE TABLE accounts RESTART IDENTITY CASCADE');
  });

  it('POST /accounts { orgName } -> 201 { accountId, apiKey }, apiKey is never persisted in plaintext', async () => {
    const res = await request(app.getHttpServer()).post('/accounts').send({ orgName: 'acme' }).expect(201);
    expect(res.body.apiKey).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const accountsRepo = dataSource.getRepository(Account);
    const row = await accountsRepo.findOneBy({ id: res.body.accountId });
    expect(row?.apiKeyHash).not.toBe(res.body.apiKey);
    expect(row?.apiKeyHash).toHaveLength(64); // sha256 hex
  });

  it('POST /accounts with a duplicate orgName -> 409', async () => {
    await request(app.getHttpServer()).post('/accounts').send({ orgName: 'acme' }).expect(201);
    await request(app.getHttpServer()).post('/accounts').send({ orgName: 'acme' }).expect(409);
  });
});
