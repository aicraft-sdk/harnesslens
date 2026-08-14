import { createHash } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ThrottlerException } from '@nestjs/throttler';
import type { Repository } from 'typeorm';
import { RejectedSubmission } from './entities/rejected-submission.entity';

interface MinimalRequest {
  body?: unknown;
}
interface MinimalResponse {
  status(code: number): { json(body: unknown): void };
}

const GENERIC_500_BODY = { statusCode: 500, message: 'Internal server error' };

/**
 * Catches every exception raised while handling POST /submissions -- HttpExceptions from the
 * global ValidationPipe or explicit service-level rejections (400), and any other failure that
 * reaches this far uncaught (DB constraint violations, numeric overflow, EntityNotFoundError from
 * repo auto-provisioning, etc.) -- and records a rejected_submissions audit row before returning
 * the correct HTTP status/body for that exception. This is the single audit-insertion point for
 * every rejection path on this endpoint, matching the "never silently drop, always a structured
 * reason" discipline: a genuine 500 still surfaces as a 500 to the caller (the raw internal error
 * is never leaked in the response body), but it is always audited with the real reason.
 *
 * Exception: ThrottlerException (429) never triggers an audit-insert. Auditing every rate-limited
 * request would let abuse-volume traffic drive DB write load, defeating rate limiting's own purpose
 * of protecting the DB from exactly that. The 429 status/body handling is unchanged either way.
 */
@Catch()
@Injectable()
export class SubmissionRejectionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SubmissionRejectionFilter.name);

  constructor(
    @InjectRepository(RejectedSubmission) private readonly rejectedRepo: Repository<RejectedSubmission>,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<MinimalRequest>();
    const response = ctx.getResponse<MinimalResponse>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : 500;
    const responseBody = isHttpException ? exception.getResponse() : GENERIC_500_BODY;
    const reason = isHttpException
      ? typeof responseBody === 'string'
        ? responseBody
        : JSON.stringify((responseBody as { message?: unknown }).message ?? responseBody)
      : exception instanceof Error
        ? exception.message
        : String(exception);
    if (!(exception instanceof ThrottlerException)) {
      const payloadHash = createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex');

      // NestJS's ExceptionsHandler/RouterProxy never awaits a custom filter's catch() return
      // value, so a rejected promise here (e.g. a transient DB blip -- exactly the condition most
      // likely to co-occur with the failures this filter exists to audit) would become an
      // unhandled promise rejection and crash the whole process, not just this one request. The
      // caller must always get the correct response regardless of whether the audit write itself
      // succeeds, so the insert is isolated in its own try/catch.
      try {
        await this.rejectedRepo.insert({ payloadHash, reason });
      } catch (insertError) {
        this.logger.error(
          `Failed to record rejected_submissions audit row (reason="${reason}", payloadHash=${payloadHash})`,
          insertError instanceof Error ? insertError.stack : String(insertError),
        );
      }
    }

    response.status(status).json(responseBody);
  }
}
