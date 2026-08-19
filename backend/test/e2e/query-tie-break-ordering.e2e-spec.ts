import { randomBytes } from 'node:crypto';
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

describe('GET /repos and GET /repos/:org/:repo agree on the latest submission when scannedAt ties', () => {
  let app: import('@nestjs/common').INestApplication;
  let dataSource: DataSource;
  let accountsRepo: Repository<Account>;
  let reposRepo: Repository<Repo>;
  let submissionsRepo: Repository<Submission>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    accountsRepo = dataSource.getRepository(Account);
    reposRepo = dataSource.getRepository(Repo);
    submissionsRepo = dataSource.getRepository(Submission);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE submissions, repos, accounts RESTART IDENTITY CASCADE');
  });

  it('agree on the same commitSha as "latest" across repeated calls when two submissions share an identical scannedAt', async () => {
    const orgName = 'acme';
    const repoId = 'acme/tie-break-widgets';
    const account = await accountsRepo.save(
      accountsRepo.create({ orgName, apiKeyHash: randomBytes(32).toString('hex') }),
    );
    const repo = await reposRepo.save(
      reposRepo.create({ repoId, accountId: account.id, visibility: 'public' }),
    );
    const tiedScannedAt = new Date('2026-08-10T00:00:00.000Z');
    const earlierSubmittedAt = new Date('2026-08-10T00:00:01.000Z');
    const laterSubmittedAt = new Date('2026-08-10T00:00:02.000Z');

    const olderRow = {
      repoId: repo.id,
      score: '50.00',
      level: { index: 1, name: 'L1' },
      dimensions: [],
      frameworkMapping: {},
      commitSha: 'a'.repeat(40),
      scannedAt: tiedScannedAt,
      submittedAt: earlierSubmittedAt,
      verified: false,
    };
    const newerRow = {
      repoId: repo.id,
      score: '75.00',
      level: { index: 2, name: 'L2' },
      dimensions: [],
      frameworkMapping: {},
      commitSha: 'b'.repeat(40),
      scannedAt: tiedScannedAt,
      submittedAt: laterSubmittedAt,
      verified: false,
    };
    // Insert order deliberately does not match submittedAt order, so a query that (incorrectly)
    // relies on insertion/row order instead of an explicit deterministic column would be exposed
    // by this ordering too.
    await submissionsRepo.insert(newerRow);
    await submissionsRepo.insert(olderRow);

    const listRes = await request(app.getHttpServer()).get('/repos').expect(200);
    const detailRes = await request(app.getHttpServer()).get('/repos/acme/tie-break-widgets').expect(200);
    const historyRes = await request(app.getHttpServer())
      .get('/repos/acme/tie-break-widgets/history')
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].commitSha).toBe(newerRow.commitSha);
    expect(detailRes.body.commitSha).toBe(newerRow.commitSha);
    expect(historyRes.body[0].commitSha).toBe(newerRow.commitSha);
    expect(historyRes.body[1].commitSha).toBe(olderRow.commitSha);

    // Repeat the calls to prove the ordering is deterministic, not incidentally stable this once.
    for (let i = 0; i < 3; i++) {
      const repeatListRes = await request(app.getHttpServer()).get('/repos').expect(200);
      const repeatDetailRes = await request(app.getHttpServer())
        .get('/repos/acme/tie-break-widgets')
        .expect(200);
      expect(repeatListRes.body[0].commitSha).toBe(newerRow.commitSha);
      expect(repeatDetailRes.body.commitSha).toBe(newerRow.commitSha);
    }
  });
});
