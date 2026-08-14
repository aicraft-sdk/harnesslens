import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';

interface RequestWithAccount {
  headers: Record<string, string | undefined>;
  account?: Account;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Soft-auth variant of ApiKeyGuard for read endpoints that must stay reachable unauthenticated
 * (public tier) while also resolving `request.account` when a valid bearer token IS presented, so
 * downstream handlers can check private-tier ownership (tenant-isolation layer (a)). Never throws
 * -- a missing header, a present-but-malformed header, and a present-but-unrecognized API key all
 * degrade identically to "unauthenticated" (request.account left undefined). Blocking access on a
 * bad header here would incorrectly gate PUBLIC repos behind auth too, since this guard runs on
 * every read request regardless of the target repo's visibility; only the downstream
 * ownership/visibility check (layer (a)) may ever reject a request.
 */
@Injectable()
export class OptionalApiKeyGuard implements CanActivate {
  constructor(@InjectRepository(Account) private readonly accountsRepo: Repository<Account>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAccount>();
    const authHeader = request.headers?.authorization;
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      return true;
    }

    const apiKey = authHeader.slice(BEARER_PREFIX.length);
    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
    const account = await this.accountsRepo.findOneBy({ apiKeyHash });
    if (account) {
      request.account = account;
    }
    return true;
  }
}
