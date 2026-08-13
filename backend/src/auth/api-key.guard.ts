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
 * Guards account-scoped write endpoints (signing-key registration, repo visibility toggling,
 * private-tier queries) by hashing the presented bearer token and matching it against
 * `accounts.api_key_hash` -- the raw key itself is never stored, only ever compared by hash
 * (Durable Decision 7).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@InjectRepository(Account) private readonly accountsRepo: Repository<Account>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAccount>();
    const authHeader = request.headers?.authorization;
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('missing or malformed Authorization header');
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
