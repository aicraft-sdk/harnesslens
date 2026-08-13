import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { Repo } from '../repos/entities/repo.entity';
import { ReposService } from '../repos/repos.service';
import { SigningKey } from '../signing-keys/entities/signing-key.entity';
import { Submission } from './entities/submission.entity';
import { RejectedSubmission } from './entities/rejected-submission.entity';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SubmissionRejectionFilter } from './submission-rejection.filter';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Repo, Submission, RejectedSubmission, SigningKey])],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, ReposService, SubmissionRejectionFilter],
})
export class SubmissionsModule {}
