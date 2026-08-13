import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { Account } from './accounts/entities/account.entity';
import { SigningKey } from './signing-keys/entities/signing-key.entity';
import { Repo } from './repos/entities/repo.entity';
import { Submission } from './submissions/entities/submission.entity';
import { RejectedSubmission } from './submissions/entities/rejected-submission.entity';
import { assertRequiredEnv } from './common/assert-required-env';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        assertRequiredEnv(['DATABASE_URL']);
        return {
          type: 'postgres',
          url: process.env.DATABASE_URL,
          entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
          synchronize: false,
          // Fail fast instead of hanging indefinitely on a reachable-but-hung DB.
          extra: { statement_timeout: 5000, connectionTimeoutMillis: 5000 },
        };
      },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
