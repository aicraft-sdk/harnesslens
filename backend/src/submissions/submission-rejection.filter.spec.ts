import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Repository } from 'typeorm';
import { SubmissionRejectionFilter } from './submission-rejection.filter';
import type { RejectedSubmission } from './entities/rejected-submission.entity';

function buildHost(body: unknown, jsonSpy: (body: unknown) => void) {
  const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
  const response = { status: statusSpy };
  const request = { body };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, statusSpy };
}

async function flushMicrotasksAndTimers(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('SubmissionRejectionFilter', () => {
  describe('when the rejectedRepo.insert audit write itself fails', () => {
    let unhandledRejectionSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      unhandledRejectionSpy = vi.fn();
      process.on('unhandledRejection', unhandledRejectionSpy);
    });

    afterEach(() => {
      process.off('unhandledRejection', unhandledRejectionSpy);
    });

    it('still sends the original response and never produces an unhandled promise rejection', async () => {
      const insert = vi.fn().mockRejectedValue(new Error('DB blip'));
      const rejectedRepo = { insert } as unknown as Repository<RejectedSubmission>;
      const filter = new SubmissionRejectionFilter(rejectedRepo);
      const jsonSpy = vi.fn();
      const { host, statusSpy } = buildHost({ repoId: 'bad shape' }, jsonSpy);

      // Deliberately not awaited: NestJS's ExceptionsHandler/RouterProxy never awaits a custom
      // filter's catch() return value in production, so this test only reproduces the real bug if
      // it mirrors that fire-and-forget invocation.
      void filter.catch(new BadRequestException('bad shape'), host);

      await flushMicrotasksAndTimers();

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: 'bad shape' }),
      );
      expect(unhandledRejectionSpy).not.toHaveBeenCalled();
    });
  });

  describe('when the exception is a ThrottlerException (429)', () => {
    it('still returns the original 429 response but skips the rejected_submissions audit-insert', async () => {
      const insert = vi.fn().mockResolvedValue({ identifiers: [{ id: 'irrelevant' }] });
      const rejectedRepo = { insert } as unknown as Repository<RejectedSubmission>;
      const filter = new SubmissionRejectionFilter(rejectedRepo);
      const jsonSpy = vi.fn();
      const { host, statusSpy } = buildHost({ repoId: 'acme/widgets' }, jsonSpy);

      await filter.catch(new ThrottlerException(), host);

      expect(statusSpy).toHaveBeenCalledWith(429);
      expect(jsonSpy).toHaveBeenCalledWith('ThrottlerException: Too Many Requests');
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
