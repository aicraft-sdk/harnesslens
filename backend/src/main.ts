import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { createGlobalValidationPipe } from './common/validation-pipe.factory';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(createGlobalValidationPipe());
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Fatal bootstrap error', err);
  process.exit(1);
});
