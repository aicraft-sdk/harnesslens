import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health/health.controller';
import { Account } from './accounts/entities/account.entity';
import { SigningKey } from './signing-keys/entities/signing-key.entity';
import { Repo } from './repos/entities/repo.entity';
import { Submission } from './submissions/entities/submission.entity';
import { RejectedSubmission } from './submissions/entities/rejected-submission.entity';
import { assertRequiredEnv } from './common/assert-required-env';
import { SubmissionsModule } from './submissions/submissions.module';
import { QueryModule } from './query/query.module';
import { AccountsModule } from './accounts/accounts.module';

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
    // forRootAsync (not forRoot) so the env var is read lazily at DI-resolution/module-compile
    // time, not eagerly when this file is first imported -- matters for tests that set
    // SUBMIT_RATE_LIMIT_PER_MIN before compiling the testing module.
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: 60_000,
          limit: Number(process.env.SUBMIT_RATE_LIMIT_PER_MIN ?? 30),
        },
      ],
    }),
    SubmissionsModule,
    QueryModule,
    AccountsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
