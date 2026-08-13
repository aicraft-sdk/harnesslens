import { Test } from '@nestjs/testing';
import request from 'supertest';
import { it } from 'vitest';
import { AppModule } from '../../src/app.module';

it('GET /health -> 200 { status: "ok" }', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  await app.close();
});
