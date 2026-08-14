import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns { status: "ok" }', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DataSource, useValue: { query: async () => [] } }],
    }).compile();
    const controller = moduleRef.get(HealthController);
    expect(controller.check()).toEqual({ status: 'ok' });
  });

  it('GET /health/db returns 503 (non-200) when the DB query rejects', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: DataSource,
          useValue: {
            query: async () => {
              throw new Error('db unreachable');
            },
          },
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get('/health/db');
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    await app.close();
  });
});
