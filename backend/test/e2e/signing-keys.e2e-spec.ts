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

const publicKeyBase64 = 'QIzp4l41mSRXOuI9o/eZsymtnu0iJx9mcQyXpaOGkws=';

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

describe('POST /accounts/:accountId/signing-keys', () => {
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
    await dataSource.query('TRUNCATE TABLE accounts, signing_keys RESTART IDENTITY CASCADE');
  });

  async function registerAccount(orgName: string) {
    const res = await request(app.getHttpServer()).post('/accounts').send({ orgName }).expect(201);
    return res.body as { accountId: string; apiKey: string };
  }

  it('registers a public key for the authenticated account -> 201 { keyId }', async () => {
    const account = await registerAccount('acme');

    const res = await request(app.getHttpServer())
      .post(`/accounts/${account.accountId}/signing-keys`)
      .set('Authorization', `Bearer ${account.apiKey}`)
      .send({ publicKey: publicKeyBase64 })
      .expect(201);

    expect(res.body.keyId).toEqual(expect.any(String));
    const signingKeysRepo = dataSource.getRepository(SigningKey);
    const row = await signingKeysRepo.findOneBy({ keyId: res.body.keyId });
    expect(row?.accountId).toBe(account.accountId);
    expect(row?.publicKey).toBe(publicKeyBase64);
    expect(row?.revokedAt).toBeNull();
  });

  it('rejects registration for :accountId that does not match the authenticated account -> 403', async () => {
    const account = await registerAccount('acme');
    const otherAccount = await registerAccount('other-org');

    await request(app.getHttpServer())
      .post(`/accounts/${otherAccount.accountId}/signing-keys`)
      .set('Authorization', `Bearer ${account.apiKey}`)
      .send({ publicKey: publicKeyBase64 })
      .expect(403);
  });
});
