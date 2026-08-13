import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, type Repository } from 'typeorm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Account } from '../../src/accounts/entities/account.entity';
import { SigningKey } from '../../src/signing-keys/entities/signing-key.entity';
import { Repo } from '../../src/repos/entities/repo.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { RejectedSubmission } from '../../src/submissions/entities/rejected-submission.entity';
import { InitSchema1786633235167 } from '../../src/migrations/1786633235167-InitSchema';
import { ReposService } from '../../src/repos/repos.service';

describe('ReposService.findOrCreateForSubmission', () => {
  let container: StartedPostgreSqlContainer;
  let ds: DataSource;
  let accountsRepo: Repository<Account>;
  let reposService: ReposService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    ds = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
      migrations: [InitSchema1786633235167],
    });
    await ds.initialize();
    await ds.runMigrations();
    accountsRepo = ds.getRepository(Account);
    reposService = new ReposService(accountsRepo, ds.getRepository(Repo));
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
    await container.stop();
  });

  it('creates a new account + repo on first submission for an unseen repoId', async () => {
    const repo = await reposService.findOrCreateForSubmission('acme/widgets');
    expect(repo.repoId).toBe('acme/widgets');
    expect(repo.visibility).toBe('public');
    const account = await accountsRepo.findOneBy({ id: repo.accountId });
    expect(account?.orgName).toBe('acme');
  });

  it('reuses the existing repo row on a second submission for the same repoId', async () => {
    const first = await reposService.findOrCreateForSubmission('acme/widgets');
    const second = await reposService.findOrCreateForSubmission('acme/widgets');
    expect(second.id).toBe(first.id);
  });
});
