import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';
import { Account } from './entities/account.entity';

export interface RegisterAccountResult {
  accountId: string;
  apiKey: string;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class AccountsService {
  constructor(@InjectRepository(Account) private readonly accountsRepo: Repository<Account>) {}

  /**
   * Issues a raw API key returned exactly once in the response -- only its SHA-256 hash is ever
   * persisted (`accounts.api_key_hash`), matching the private-key-never-stored spirit of Ed25519
   * applied to the API key too (Durable Decision 7).
   */
  async register(orgName: string): Promise<RegisterAccountResult> {
    const apiKey = randomBytes(32).toString('base64url');
    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');

    try {
      const insertResult = await this.accountsRepo.insert({ orgName, apiKeyHash });
      const accountId = insertResult.identifiers[0]?.id as string;
      return { accountId, apiKey };
    } catch (error) {
      if (error instanceof QueryFailedError && (error as unknown as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(`account with orgName "${orgName}" already exists`);
      }
      throw error;
    }
  }
}
