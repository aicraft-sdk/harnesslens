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
    const repo = await this.reposService.findOrCreateForSubmission(dto.repoId);
    const result = this.submissionsService.buildInsertableSubmission(dto, repo.id);
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    // Field-by-field row, never `{ ...dto }`, per the reconstruction discipline.
    const insertResult = await this.submissionsRepo.insert(result.row);
    return { id: insertResult.identifiers[0]?.id, verified: result.row.verified };
  }
}
