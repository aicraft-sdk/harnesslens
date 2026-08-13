import { createHash } from 'node:crypto';
import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { RejectedSubmission } from './entities/rejected-submission.entity';

interface MinimalRequest {
  body?: unknown;
}
interface MinimalResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Catches any BadRequestException raised while handling POST /submissions -- whether thrown by
 * the global ValidationPipe (missing/extra field, malformed shape) or explicitly by
 * SubmissionsController on a service-level `ok: false` rejection -- and records a
 * rejected_submissions audit row before returning the same structured 400 response. This is the
 * single audit-insertion point for both rejection paths, matching the "never silently drop,
 * always a structured reason" discipline.
 */
@Catch(BadRequestException)
@Injectable()
export class SubmissionRejectionFilter implements ExceptionFilter {
  constructor(
    @InjectRepository(RejectedSubmission) private readonly rejectedRepo: Repository<RejectedSubmission>,
  ) {}

  async catch(exception: BadRequestException, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<MinimalRequest>();
    const response = ctx.getResponse<MinimalResponse>();
    const responseBody = exception.getResponse();
    const reason =
      typeof responseBody === 'string'
        ? responseBody
        : JSON.stringify((responseBody as { message?: unknown }).message ?? responseBody);
    const payloadHash = createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex');

    await this.rejectedRepo.insert({ payloadHash, reason });

    response.status(exception.getStatus()).json(responseBody);
  }
}
