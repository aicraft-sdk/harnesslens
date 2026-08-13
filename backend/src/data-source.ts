import 'reflect-metadata';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://harnesslens:harnesslens@localhost:5432/harnesslens',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
