import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
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
import { AddChecksToSubmissions1787124757663 } from '../../src/migrations/1787124757663-AddChecksToSubmissions';
import { createGlobalValidationPipe } from '../../src/common/validation-pipe.factory';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from '../../src/signing/canonical-payload';

const validSubmissionFields: CanonicalSubmissionFields = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

function rawPublicKeyBase64(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function signFields(privateKey: KeyObject, fields: CanonicalSubmissionFields): string {
  const canonical = buildCanonicalPayload(fields);
  return sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
}

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

describe('POST /submissions -- verified tier (Ed25519 signature verification)', () => {
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
    await dataSource.query(
      'TRUNCATE TABLE accounts, repos, signing_keys, submissions, rejected_submissions RESTART IDENTITY CASCADE',
    );
  });

  async function registerAccountAndKey(orgName: string) {
    const accountRes = await request(app.getHttpServer()).post('/accounts').send({ orgName }).expect(201);
    const account = accountRes.body as { accountId: string; apiKey: string };
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyBase64 = rawPublicKeyBase64(publicKey);
    const keyRes = await request(app.getHttpServer())
      .post(`/accounts/${account.accountId}/signing-keys`)
      .set('Authorization', `Bearer ${account.apiKey}`)
      .send({ publicKey: publicKeyBase64 })
      .expect(201);
    return { account, privateKey, keyId: keyRes.body.keyId as string };
  }

  it('a signed submission from a registered key -> 201, verified: true', async () => {
    const { keyId, privateKey } = await registerAccountAndKey('acme');
    const signature = signFields(privateKey, validSubmissionFields);

    const res = await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...validSubmissionFields, keyId, signature })
      .expect(201);

    expect(res.body).toMatchObject({ verified: true });
    const submissionsRepo = dataSource.getRepository(Submission);
    const row = await submissionsRepo.findOneBy({ id: res.body.id });
    expect(row?.verified).toBe(true);
    expect(row?.signature).toBe(signature);
    expect(row?.keyId).toBe(keyId);
  });

  it('a submission with keyId set but an invalid signature -> 400, NOT persisted at all', async () => {
    const { keyId } = await registerAccountAndKey('acme');

    await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...validSubmissionFields, keyId, signature: 'invalid-base64-garbage' })
      .expect(400);

    // Critical: never persisted as verified:false -- a bad signature must be rejected outright,
    // not silently downgraded to an unverified (but still accepted) submission.
    const submissionsRepo = dataSource.getRepository(Submission);
    expect(await submissionsRepo.count()).toBe(0);
  });

  it('a submission signed with a revoked key -> 400, not persisted', async () => {
    const { keyId, privateKey } = await registerAccountAndKey('acme');
    await dataSource.getRepository(SigningKey).update({ keyId }, { revokedAt: new Date() });
    const signature = signFields(privateKey, validSubmissionFields);

    await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...validSubmissionFields, keyId, signature })
      .expect(400);

    const submissionsRepo = dataSource.getRepository(Submission);
    expect(await submissionsRepo.count()).toBe(0);
  });

  it('a submission with an unknown keyId -> 400', async () => {
    await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...validSubmissionFields, keyId: 'no-such-key-id', signature: 'AAAAAAAAAAAAAAAAAAAA' })
      .expect(400);

    const submissionsRepo = dataSource.getRepository(Submission);
    expect(await submissionsRepo.count()).toBe(0);
  });

  it('a key registered by one account cannot produce verified: true for a repo effectively owned by a different account (cross-account key binding) -- 400, not persisted at all', async () => {
    // Account "acme" registers a genuinely valid signing key.
    const { keyId, privateKey } = await registerAccountAndKey('acme');
    // The repoId's org segment ("othercorp") is different from "acme" -- submitting against it
    // auto-provisions a brand new, separate account ("othercorp") that "acme"'s key was never
    // registered under. The signature itself is cryptographically valid over the correct
    // canonical payload for this exact repoId -- only the account-binding check can catch this.
    const crossAccountFields: CanonicalSubmissionFields = {
      ...validSubmissionFields,
      repoId: 'othercorp/widgets',
    };
    const signature = signFields(privateKey, crossAccountFields);

    await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...crossAccountFields, keyId, signature })
      .expect(400);

    // Critical: never persisted as verified:true (or at all) -- a signature that is valid but
    // bound to the wrong account must be rejected outright, the same as any other invalid
    // signature.
    const submissionsRepo = dataSource.getRepository(Submission);
    expect(await submissionsRepo.count()).toBe(0);
  });

  it('a rejected cross-account signed submission does not permanently provision accounts/repos rows for the targeted (never-seen) org', async () => {
    // Account "acme" registers a genuinely valid signing key.
    const { keyId, privateKey } = await registerAccountAndKey('acme');
    const accountsRepo = dataSource.getRepository(Account);
    const reposRepo = dataSource.getRepository(Repo);
    const accountsBefore = await accountsRepo.count();
    const reposBefore = await reposRepo.count();

    // "othercorp" has never been seen before by this server. The signature is cryptographically
    // valid over the correct canonical payload for this exact repoId -- only the account-binding
    // check can catch this forgery attempt.
    const crossAccountFields: CanonicalSubmissionFields = {
      ...validSubmissionFields,
      repoId: 'othercorp/widgets',
    };
    const signature = signFields(privateKey, crossAccountFields);

    await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...crossAccountFields, keyId, signature })
      .expect(400);

    // Critical: a rejected forgery attempt must never permanently create accounts/repos rows for
    // the targeted org -- accounts.org_name is unique, so a leaked row would permanently block
    // that org's real owner from ever registering. Account resolution inside the verification
    // path must be read-only.
    expect(await accountsRepo.count()).toBe(accountsBefore);
    expect(await reposRepo.count()).toBe(reposBefore);
  });
});
