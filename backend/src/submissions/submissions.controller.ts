import { BadRequestException, Body, Controller, HttpCode, Post, UseFilters, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Repository } from 'typeorm';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { Submission } from './entities/submission.entity';
import { ReposService } from '../repos/repos.service';
import { SubmissionsService } from './submissions.service';
import { SubmissionRejectionFilter } from './submission-rejection.filter';

@Controller('submissions')
@UseFilters(SubmissionRejectionFilter)
@UseGuards(ThrottlerGuard)
export class SubmissionsController {
  constructor(
    private readonly reposService: ReposService,
    private readonly submissionsService: SubmissionsService,
    @InjectRepository(Submission) private readonly submissionsRepo: Repository<Submission>,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateSubmissionDto) {
    // Validation must run before any provisioning side effect: `findOrCreateForSubmission`
    // permanently creates `accounts`/`repos` rows, so it only runs once the submission is known
    // to be insertable -- a rejected submission must never leave an orphaned, permanently-existing
    // repo row behind.
    const result = this.submissionsService.buildInsertableSubmission(dto);
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    const repo = await this.reposService.findOrCreateForSubmission(dto.repoId);
    // Field-by-field row (never `{ ...dto }`), with the resolved repo UUID attached last.
    const insertResult = await this.submissionsRepo.insert({ ...result.row, repoId: repo.id });
    return { id: insertResult.identifiers[0]?.id, verified: result.row.verified };
  }
}
