import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
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
 * for a missing Authorization header -- only for a header that is present but malformed or
 * doesn't match any account, matching the plan's "doesn't throw when absent, only when
 * present-and-invalid" contract.
 */
@Injectable()
export class OptionalApiKeyGuard implements CanActivate {
  constructor(@InjectRepository(Account) private readonly accountsRepo: Repository<Account>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAccount>();
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return true;
    }
    if (!authHeader.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('malformed Authorization header');
    }

    const apiKey = authHeader.slice(BEARER_PREFIX.length);
    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
    const account = await this.accountsRepo.findOneBy({ apiKeyHash });
    if (!account) {
      throw new UnauthorizedException('invalid API key');
    }

    request.account = account;
    return true;
  }
}
