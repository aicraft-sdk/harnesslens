import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Repository } from 'typeorm';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { Submission } from './entities/submission.entity';
import { ReposService } from '../repos/repos.service';
import { SubmissionsService } from './submissions.service';
import { SubmissionRejectionFilter } from './submission-rejection.filter';
import { SubmissionEvidenceService } from './submission-evidence.service';
import { OptionalApiKeyGuard } from '../auth/optional-api-key.guard';
import type { Account } from '../accounts/entities/account.entity';

interface RequestWithAccount {
  account?: Account;
}

@Controller('submissions')
export class SubmissionsController {
  constructor(
    private readonly reposService: ReposService,
    private readonly submissionsService: SubmissionsService,
    @InjectRepository(Submission) private readonly submissionsRepo: Repository<Submission>,
    private readonly evidenceService: SubmissionEvidenceService,
  ) {}

  // `@UseFilters(SubmissionRejectionFilter)` and `@UseGuards(ThrottlerGuard)` are scoped to this
  // method only, not the class -- both are write-path (POST) concerns. Applying either at the
  // class level would also apply SubmissionRejectionFilter's blanket `@Catch()` to the GET
  // /:id/evidence route below, incorrectly auditing every plain evidence-lookup 404 as a
  // rejected_submissions row (unthrottled write-amplification risk against an unauthenticated,
  // guard-optional read endpoint).
  @Post()
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @UseFilters(SubmissionRejectionFilter)
  async create(@Body() dto: CreateSubmissionDto) {
    // Validation must run before any provisioning side effect: `findOrCreateForSubmission`
    // permanently creates `accounts`/`repos` rows, so it only runs once the submission is known
    // to be insertable -- a rejected submission must never leave an orphaned, permanently-existing
    // repo row behind.
    const result = await this.submissionsService.buildInsertableSubmission(dto);
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    const repo = await this.reposService.findOrCreateForSubmission(dto.repoId);
    // Field-by-field row (never `{ ...dto }`), with the resolved repo UUID attached last.
    const insertResult = await this.submissionsRepo.insert({ ...result.row, repoId: repo.id });
    return { id: insertResult.identifiers[0]?.id, verified: result.row.verified };
  }

  @Get(':id/evidence')
  @UseGuards(OptionalApiKeyGuard)
  async getEvidence(@Param('id') id: string, @Req() req: RequestWithAccount) {
    const evidence = await this.evidenceService.getEvidence(id, req.account?.id);
    if (!evidence) {
      throw new NotFoundException();
    }
    return evidence;
  }
}
