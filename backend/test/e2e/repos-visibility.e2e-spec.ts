import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, type Repository } from 'typeorm';
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

describe('PATCH /accounts/:accountId/repos/:repoId/visibility', () => {
  let app: import('@nestjs/common').INestApplication;
  let dataSource: DataSource;
  let reposRepo: Repository<Repo>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    dataSource = moduleRef.get(DataSource);
    reposRepo = dataSource.getRepository(Repo);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE submissions, repos, accounts RESTART IDENTITY CASCADE');
  });

  async function registerAccount(orgName: string) {
    const res = await request(app.getHttpServer()).post('/accounts').send({ orgName }).expect(201);
    return res.body as { accountId: string; apiKey: string };
  }

  async function seedRepo(accountId: string, repoId: string, visibility: 'public' | 'private' = 'public') {
    return reposRepo.save(reposRepo.create({ repoId, accountId, visibility }));
  }

  it('owner can set their own repo to private -> 200', async () => {
    const account = await registerAccount('acme');
    const repo = await seedRepo(account.accountId, 'acme/widgets', 'public');

    const res = await request(app.getHttpServer())
      .patch(`/accounts/${account.accountId}/repos/${repo.id}/visibility`)
      .set('Authorization', `Bearer ${account.apiKey}`)
      .send({ visibility: 'private' })
      .expect(200);

    expect(res.body).toEqual({ repoId: 'acme/widgets', visibility: 'private' });
    const row = await reposRepo.findOneBy({ id: repo.id });
    expect(row?.visibility).toBe('private');
  });

  it('a different account cannot change visibility for a repo they do not own -> 403', async () => {
    const account = await registerAccount('acme');
    const otherAccount = await registerAccount('other-org');
    const repo = await seedRepo(account.accountId, 'acme/widgets', 'public');

    await request(app.getHttpServer())
      .patch(`/accounts/${account.accountId}/repos/${repo.id}/visibility`)
      .set('Authorization', `Bearer ${otherAccount.apiKey}`)
      .send({ visibility: 'private' })
      .expect(403);

    const row = await reposRepo.findOneBy({ id: repo.id });
    expect(row?.visibility).toBe('public');
  });

  it('unauthenticated request -> 401', async () => {
    const account = await registerAccount('acme');
    const repo = await seedRepo(account.accountId, 'acme/widgets', 'public');

    await request(app.getHttpServer())
      .patch(`/accounts/${account.accountId}/repos/${repo.id}/visibility`)
      .send({ visibility: 'private' })
      .expect(401);

    const row = await reposRepo.findOneBy({ id: repo.id });
    expect(row?.visibility).toBe('public');
  });

  it('a non-UUID repoId returns a clean 400, never a raw 500', async () => {
    const account = await registerAccount('acme');

    const res = await request(app.getHttpServer())
      .patch(`/accounts/${account.accountId}/repos/not-a-uuid/visibility`)
      .set('Authorization', `Bearer ${account.apiKey}`)
      .send({ visibility: 'private' })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
  });
});
