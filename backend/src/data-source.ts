import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { assertRequiredEnv } from './common/assert-required-env';

assertRequiredEnv(['DATABASE_URL']);

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
