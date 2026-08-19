import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
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
import { buildCanonicalPayload, type CanonicalSubmissionFields } from '../../src/signing/canonical-payload';
import { verifyEd25519 } from '../../src/signing/ed25519';

const validSubmissionFields: CanonicalSubmissionFields = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  checks: [
    {
      id: 'CTX-01',
      dimension: 'context',
      title: 'Has AGENTS.md',
      points: 5,
      earned: 5,
      passed: true,
      evidence: 'Found AGENTS.md at repo root',
    },
  ],
  // Non-empty, so this fixture actually exercises frameworkMapping through a real Postgres jsonb
  // round trip -- an empty `{}` (as this field previously was) has no entry keys that could ever
  // be reordered, so it can never exercise the jsonb-key-reordering bug this test is meant to
  // guard against. PostgreSQL's jsonb column does not preserve an object's original key insertion
  // order -- it always normalizes to its own internal key order on storage/retrieval -- so a
  // signed submission's `frameworkMapping` entry read back via `GET /submissions/:id/evidence`
  // (see this test's reconstruction step below, mimicking a real third-party verifier) can come
  // back with a different per-entry key order than what was originally signed, unless
  // buildCanonicalPayload rebuilds each entry with an explicit, fixed key order rather than
  // passing the DB-round-tripped value through as-is (the exact bug found during Phase 6's live
  // end-to-end proof, fixed in canonical-payload.ts).
  frameworkMapping: {
    ci: { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI04', 'ASI08'] },
  },
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
    migrations: [InitSchema1786633235167, AddChecksToSubmissions1787126020558],
  });
  await migrationDs.initialize();
  await migrationDs.runMigrations();
  await migrationDs.destroy();
}, 60_000);

afterAll(async () => {
  await container.stop();
});

describe('GET /submissions/:id/evidence', () => {
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
    return { account, privateKey, publicKeyBase64, keyId: keyRes.body.keyId as string };
  }

  it('golden path: a verified-tier submission with checks[] can be independently re-verified end to end', async () => {
    const { keyId, privateKey, publicKeyBase64 } = await registerAccountAndKey('acme');
    const signature = signFields(privateKey, validSubmissionFields);

    const createRes = await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...validSubmissionFields, keyId, signature })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/submissions/${createRes.body.id}/evidence`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: createRes.body.id,
      repoId: 'acme/widgets',
      checks: validSubmissionFields.checks,
      verified: true,
      signature,
      keyId,
      publicKey: publicKeyBase64,
    });

    // The actual end-to-end cryptographic proof: independently reconstruct the canonical payload
    // from the response body alone (as a real third-party verifier would) and verify it against
    // the returned signature/publicKey.
    const reconstructed = buildCanonicalPayload({
      repoId: res.body.repoId,
      score: res.body.score,
      level: res.body.level,
      dimensions: res.body.dimensions,
      checks: res.body.checks,
      frameworkMapping: res.body.frameworkMapping,
      commitSha: res.body.commitSha,
      scannedAt: res.body.scannedAt,
    });
    expect(verifyEd25519(res.body.publicKey, reconstructed, res.body.signature)).toBe(true);
  });

  it('the response body has exactly the 12 whitelisted keys, no extras', async () => {
    const { keyId, privateKey } = await registerAccountAndKey('acme');
    const signature = signFields(privateKey, validSubmissionFields);
    const createRes = await request(app.getHttpServer())
      .post('/submissions')
      .send({ ...validSubmissionFields, keyId, signature })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/submissions/${createRes.body.id}/evidence`)
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual(
      [
        'id',
        'repoId',
        'score',
        'level',
        'dimensions',
        'checks',
        'frameworkMapping',
        'commitSha',
        'scannedAt',
        'verified',
        'signature',
        'keyId',
        'publicKey',
      ].sort(),
    );
  });

  it('returns 404 for an unknown submission id', async () => {
    await request(app.getHttpServer())
      .get('/submissions/11111111-1111-4111-8111-111111111111/evidence')
      .expect(404);
  });

  it('returns 404 (never 500) for a malformed, non-UUID submission id', async () => {
    await request(app.getHttpServer()).get('/submissions/not-a-uuid/evidence').expect(404);
  });

  it('returns 404 to an unauthenticated caller for a private repo submission', async () => {
    const account = await request(app.getHttpServer()).post('/accounts').send({ orgName: 'acme' }).expect(201);
    const accountBody = account.body as { accountId: string };
    const repo = await reposRepo.save(
      reposRepo.create({ repoId: 'acme/private-widgets', accountId: accountBody.accountId, visibility: 'private' }),
    );
    const insertResult = await submissionsRepo.insert({
      repoId: repo.id,
      score: '50',
      level: { index: 1, name: 'L1' },
      dimensions: [],
      checks: null,
      frameworkMapping: {},
      commitSha: 'a'.repeat(40),
      scannedAt: new Date(),
      verified: false,
    });
    const submissionId = insertResult.identifiers[0]?.id as string;

    await request(app.getHttpServer()).get(`/submissions/${submissionId}/evidence`).expect(404);
  });

  it('returns 404 to a non-owning authenticated account for a private repo submission', async () => {
    const owner = await request(app.getHttpServer()).post('/accounts').send({ orgName: 'acme' }).expect(201);
    const ownerBody = owner.body as { accountId: string };
    const other = await request(app.getHttpServer()).post('/accounts').send({ orgName: 'othercorp' }).expect(201);
    const otherBody = other.body as { apiKey: string };
    const repo = await reposRepo.save(
      reposRepo.create({ repoId: 'acme/private-widgets', accountId: ownerBody.accountId, visibility: 'private' }),
    );
    const insertResult = await submissionsRepo.insert({
      repoId: repo.id,
      score: '50',
      level: { index: 1, name: 'L1' },
      dimensions: [],
      checks: null,
      frameworkMapping: {},
      commitSha: 'a'.repeat(40),
      scannedAt: new Date(),
      verified: false,
    });
    const submissionId = insertResult.identifiers[0]?.id as string;

    await request(app.getHttpServer())
      .get(`/submissions/${submissionId}/evidence`)
      .set('Authorization', `Bearer ${otherBody.apiKey}`)
      .expect(404);
  });

  it('returns 200 to the owning authenticated account for a private repo submission', async () => {
    const owner = await request(app.getHttpServer()).post('/accounts').send({ orgName: 'acme' }).expect(201);
    const ownerBody = owner.body as { accountId: string; apiKey: string };
    const repo = await reposRepo.save(
      reposRepo.create({ repoId: 'acme/private-widgets', accountId: ownerBody.accountId, visibility: 'private' }),
    );
    const insertResult = await submissionsRepo.insert({
      repoId: repo.id,
      score: '50',
      level: { index: 1, name: 'L1' },
      dimensions: [],
      checks: null,
      frameworkMapping: {},
      commitSha: 'a'.repeat(40),
      scannedAt: new Date(),
      verified: false,
    });
    const submissionId = insertResult.identifiers[0]?.id as string;

    const res = await request(app.getHttpServer())
      .get(`/submissions/${submissionId}/evidence`)
      .set('Authorization', `Bearer ${ownerBody.apiKey}`)
      .expect(200);

    expect(res.body.id).toBe(submissionId);
  });

  it('the GET route does not write a rejected_submissions audit row on a plain evidence-lookup 404', async () => {
    const rejectedRepo = dataSource.getRepository(RejectedSubmission);
    const before = await rejectedRepo.count();

    await request(app.getHttpServer())
      .get('/submissions/11111111-1111-4111-8111-111111111111/evidence')
      .expect(404);

    expect(await rejectedRepo.count()).toBe(before);
  });
});
