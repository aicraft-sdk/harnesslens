import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { afterAll, beforeAll, it } from 'vitest';
import { AppModule } from '../../src/app.module';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
}, 60_000);

afterAll(async () => {
  await container.stop();
});

it('GET /health -> 200 { status: "ok" }', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  await app.close();
});

it('GET /health/db -> 200 { status: "ok" } when DB is reachable', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await request(app.getHttpServer()).get('/health/db').expect(200, { status: 'ok' });
  await app.close();
});
