import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { OptionalApiKeyGuard } from '../auth/optional-api-key.guard';
import { Repo } from '../repos/entities/repo.entity';
import { ReposService } from '../repos/repos.service';
import { Submission } from '../submissions/entities/submission.entity';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Repo, Submission])],
  controllers: [QueryController],
  providers: [QueryService, ReposService, OptionalApiKeyGuard],
})
export class QueryModule {}
