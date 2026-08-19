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
import { AddChecksToSubmissions1787124757663 } from '../../src/migrations/1787124757663-AddChecksToSubmissions';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const migrationDs = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
    migrations: [InitSchema1786633235167, AddChecksToSubmissions1787124757663],
  });
  await migrationDs.initialize();
  await migrationDs.runMigrations();
  await migrationDs.destroy();
}, 60_000);

afterAll(async () => {
  await container.stop();
});

describe('GET /repos', () => {
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
    // Each test starts from a clean slate so exact-count/exact-shape assertions below aren't
    // affected by earlier tests sharing the same Testcontainers Postgres.
    await dataSource.query('TRUNCATE TABLE submissions, repos, accounts RESTART IDENTITY CASCADE');
  });

  async function seedSubmission(
    repoId: string,
    overrides: { scannedAt?: string; score?: number } = {},
    repoOverrides: { visibility?: 'public' | 'private' } = {},
  ): Promise<Repo> {
    const orgName = repoId.split('/')[0]!;
    let account = await accountsRepo.findOneBy({ orgName });
    if (!account) {
      account = await accountsRepo.save(
        accountsRepo.create({ orgName, apiKeyHash: randomBytes(32).toString('hex') }),
      );
    }
    let repo = await reposRepo.findOneBy({ repoId });
    if (!repo) {
      repo = await reposRepo.save(
        reposRepo.create({ repoId, accountId: account.id, visibility: repoOverrides.visibility ?? 'public' }),
      );
    }
    await submissionsRepo.insert({
      repoId: repo.id,
      score: String(overrides.score ?? 50),
      level: { index: 1, name: 'L1' },
      dimensions: [],
      frameworkMapping: {},
      commitSha: 'a'.repeat(40),
      scannedAt: new Date(overrides.scannedAt ?? new Date().toISOString()),
      verified: false,
    });
    return repo;
  }

  it('returns only the latest submission per public repoId, excludes private repos', async () => {
    await seedSubmission('acme/widgets', { scannedAt: '2026-08-01T00:00:00Z' });
    await seedSubmission('acme/widgets', { scannedAt: '2026-08-10T00:00:00Z' }); // newer, same repo
    await seedSubmission('other/private-repo', { scannedAt: '2026-08-05T00:00:00Z' }, { visibility: 'private' });

    const res = await request(app.getHttpServer()).get('/repos').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].repoId).toBe('acme/widgets');
    expect(res.body[0].scannedAt).toBe('2026-08-10T00:00:00.000Z');
  });

  it('returns an empty array when no public submissions exist', async () => {
    const res = await request(app.getHttpServer()).get('/repos').expect(200);
    expect(res.body).toEqual([]);
  });
});
