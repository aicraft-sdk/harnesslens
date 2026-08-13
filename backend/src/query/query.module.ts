import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repo } from '../repos/entities/repo.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [TypeOrmModule.forFeature([Repo, Submission])],
  controllers: [QueryController],
  providers: [QueryService],
})
export class QueryModule {}
