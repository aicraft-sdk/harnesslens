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
import { AddChecksToSubmissions1787126020558 } from '../../src/migrations/1787126020558-AddChecksToSubmissions';
import { createGlobalValidationPipe } from '../../src/common/validation-pipe.factory';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
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
});

describe('Private-tier read endpoints (GET /repos/:org/:repo, /history, and GET /repos)', () => {
  let app: import('@nestjs/common').INestApplication;
  let dataSource: DataSource;
  let reposRepo: Repository<Repo>;
  let submissionsRepo: Repository<Submission>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    dataSource = moduleRef.get(DataSource);
    reposRepo = dataSource.getRepository(Repo);
    submissionsRepo = dataSource.getRepository(Submission);
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

  async function seedPrivateSubmission(accountId: string, repoId: string) {
    const repo = await reposRepo.save(reposRepo.create({ repoId, accountId, visibility: 'private' }));
    await submissionsRepo.insert({
      repoId: repo.id,
      score: '50',
      level: { index: 1, name: 'L1' },
      dimensions: [],
      frameworkMapping: {},
      commitSha: 'a'.repeat(40),
      scannedAt: new Date(),
      verified: false,
    });
    return repo;
  }

  async function seedPublicSubmission(accountId: string, repoId: string) {
    const repo = await reposRepo.save(reposRepo.create({ repoId, accountId, visibility: 'public' }));
    await submissionsRepo.insert({
      repoId: repo.id,
      score: '50',
      level: { index: 1, name: 'L1' },
      dimensions: [],
      frameworkMapping: {},
      commitSha: 'a'.repeat(40),
      scannedAt: new Date(),
      verified: false,
    });
    return repo;
  }

  it('owner with valid API key sees their own private repo history -> 200', async () => {
    const account = await registerAccount('acme');
    await seedPrivateSubmission(account.accountId, 'acme/private-repo');

    const detailRes = await request(app.getHttpServer())
      .get('/repos/acme/private-repo')
      .set('Authorization', `Bearer ${account.apiKey}`)
      .expect(200);
    expect(detailRes.body).toMatchObject({ repoId: 'acme/private-repo', score: 50 });

    const historyRes = await request(app.getHttpServer())
      .get('/repos/acme/private-repo/history')
      .set('Authorization', `Bearer ${account.apiKey}`)
      .expect(200);
    expect(historyRes.body).toHaveLength(1);
    expect(historyRes.body[0]).toMatchObject({ repoId: 'acme/private-repo', score: 50 });
  });

  it("a different authenticated account gets 404 (not 403) for another account's private repo", async () => {
    const account = await registerAccount('acme');
    const otherAccount = await registerAccount('other-org');
    await seedPrivateSubmission(account.accountId, 'acme/private-repo');

    await request(app.getHttpServer())
      .get('/repos/acme/private-repo')
      .set('Authorization', `Bearer ${otherAccount.apiKey}`)
      .expect(404);

    await request(app.getHttpServer())
      .get('/repos/acme/private-repo/history')
      .set('Authorization', `Bearer ${otherAccount.apiKey}`)
      .expect(404);
  });

  it('unauthenticated caller gets 404 (not 401) for a private repo -- same shape as "never existed"', async () => {
    const account = await registerAccount('acme');
    await seedPrivateSubmission(account.accountId, 'acme/private-repo');

    const privateRes = await request(app.getHttpServer()).get('/repos/acme/private-repo').expect(404);
    const neverExistedRes = await request(app.getHttpServer()).get('/repos/acme/never-existed').expect(404);
    expect(privateRes.status).toBe(neverExistedRes.status);
    expect(privateRes.body).toEqual(neverExistedRes.body);

    const privateHistoryRes = await request(app.getHttpServer()).get('/repos/acme/private-repo/history').expect(404);
    const neverExistedHistoryRes = await request(app.getHttpServer()).get('/repos/acme/never-existed/history').expect(404);
    expect(privateHistoryRes.status).toBe(neverExistedHistoryRes.status);
    expect(privateHistoryRes.body).toEqual(neverExistedHistoryRes.body);
  });

  it('a private repo never appears in GET /repos (public listing), even when queried by its owner', async () => {
    const account = await registerAccount('acme');
    await seedPrivateSubmission(account.accountId, 'acme/private-repo');

    const res = await request(app.getHttpServer())
      .get('/repos')
      .set('Authorization', `Bearer ${account.apiKey}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('a garbage Authorization header on a PUBLIC repo still returns 200 (OptionalApiKeyGuard degrades to unauthenticated, never throws)', async () => {
    const account = await registerAccount('acme');
    await seedPublicSubmission(account.accountId, 'acme/public-repo');

    await request(app.getHttpServer())
      .get('/repos/acme/public-repo')
      .set('Authorization', 'garbage-not-a-bearer-token')
      .expect(200);

    await request(app.getHttpServer())
      .get('/repos/acme/public-repo/history')
      .set('Authorization', 'garbage-not-a-bearer-token')
      .expect(200);
  });

  it('the same garbage Authorization header on a PRIVATE repo returns 404 (not 401)', async () => {
    const account = await registerAccount('acme');
    await seedPrivateSubmission(account.accountId, 'acme/private-repo');

    await request(app.getHttpServer())
      .get('/repos/acme/private-repo')
      .set('Authorization', 'garbage-not-a-bearer-token')
      .expect(404);

    await request(app.getHttpServer())
      .get('/repos/acme/private-repo/history')
      .set('Authorization', 'garbage-not-a-bearer-token')
      .expect(404);
  });
});
