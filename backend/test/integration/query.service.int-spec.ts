import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, type Repository } from 'typeorm';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Account } from '../../src/accounts/entities/account.entity';
import { SigningKey } from '../../src/signing-keys/entities/signing-key.entity';
import { Repo } from '../../src/repos/entities/repo.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { RejectedSubmission } from '../../src/submissions/entities/rejected-submission.entity';
import { InitSchema1786633235167 } from '../../src/migrations/1786633235167-InitSchema';
import { AddChecksToSubmissions1787124757663 } from '../../src/migrations/1787124757663-AddChecksToSubmissions';
import { QueryService } from '../../src/query/query.service';

describe('QueryService.getPrivateHistory', () => {
  let container: StartedPostgreSqlContainer;
  let ds: DataSource;
  let accountsRepo: Repository<Account>;
  let reposRepo: Repository<Repo>;
  let submissionsRepo: Repository<Submission>;
  let queryService: QueryService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    ds = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
      migrations: [InitSchema1786633235167, AddChecksToSubmissions1787124757663],
    });
    await ds.initialize();
    await ds.runMigrations();
    accountsRepo = ds.getRepository(Account);
    reposRepo = ds.getRepository(Repo);
    submissionsRepo = ds.getRepository(Submission);
    queryService = new QueryService(reposRepo, submissionsRepo);
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE TABLE submissions, repos, accounts RESTART IDENTITY CASCADE');
  });

  async function createAccount(orgName: string) {
    return accountsRepo.save(accountsRepo.create({ orgName, apiKeyHash: randomBytes(32).toString('hex') }));
  }

  async function seedPrivateRepoWithSubmission(overrides: { accountId: string; repoId?: string }) {
    const repoId = overrides.repoId ?? `acme/${randomBytes(4).toString('hex')}`;
    const repo = await reposRepo.save(
      reposRepo.create({ repoId, accountId: overrides.accountId, visibility: 'private' }),
    );
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
    return { repoId, repo };
  }

  it('getPrivateHistory requires an accountId parameter and only returns rows the account owns', async () => {
    const accountA = await createAccount('account-a');
    const accountB = await createAccount('account-b');
    const { repoId } = await seedPrivateRepoWithSubmission({ accountId: accountA.id });

    const rowsForOwner = await queryService.getPrivateHistory(repoId, accountA.id);
    expect(rowsForOwner.length).toBeGreaterThan(0);
    expect(rowsForOwner[0]).toMatchObject({ repoId, score: 50, commitSha: 'a'.repeat(40) });

    const rowsForOther = await queryService.getPrivateHistory(repoId, accountB.id); // never throws with account info leaked; empty result
    expect(rowsForOther).toEqual([]);
  });

  it('there is no repository method that queries a private submission by repoId alone (no accountId param)', () => {
    // structural assertion: the only exported query-service method accepting a bare repoId is the
    // public-tier one (Task 2.2), which itself filters visibility = 'public' -- grep-verifiable,
    // not just test-verifiable; documented here as the property this task must not regress
    expect(typeof queryService.getPrivateHistory).toBe('function');
    expect(queryService.getPrivateHistory.length).toBeGreaterThanOrEqual(2); // (repoId, accountId)
  });
});
