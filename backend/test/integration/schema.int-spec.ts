import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { describe, it, expect } from 'vitest';
import { Account } from '../../src/accounts/entities/account.entity';
import { SigningKey } from '../../src/signing-keys/entities/signing-key.entity';
import { Repo } from '../../src/repos/entities/repo.entity';
import { Submission } from '../../src/submissions/entities/submission.entity';
import { RejectedSubmission } from '../../src/submissions/entities/rejected-submission.entity';
import { InitSchema1786633235167 } from '../../src/migrations/1786633235167-InitSchema';

// Entities/migrations are passed as imported classes, not glob strings — TypeORM's glob-based
// loader dynamically `require()`s matched files, which cannot parse .ts source when running
// inside Vitest's own module runtime (no global ts-node hook registered). Direct imports go
// through Vitest's own SWC-transformed module graph instead, same as every other import here.
describe('database schema', () => {
  it('creates all five tables after running migrations', async () => {
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const ds = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
      migrations: [InitSchema1786633235167],
    });
    await ds.initialize();
    await ds.runMigrations();
    const tables = await ds.query(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = tables.map((t: { table_name: string }) => t.table_name).sort();
    expect(names).toEqual([
      'accounts',
      'migrations',
      'rejected_submissions',
      'repos',
      'signing_keys',
      'submissions',
    ]);
    await ds.destroy();
    await container.stop();
  }, 60_000);
});
