import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { SigningKey } from './entities/signing-key.entity';

export interface RegisterSigningKeyResult {
  keyId: string;
}

@Injectable()
export class SigningKeysService {
  constructor(@InjectRepository(SigningKey) private readonly signingKeysRepo: Repository<SigningKey>) {}

  async register(accountId: string, publicKey: string): Promise<RegisterSigningKeyResult> {
    const keyId = randomUUID();
    await this.signingKeysRepo.insert({ accountId, publicKey, keyId, revokedAt: null });
    return { keyId };
  }

  /**
   * Scoped update (WHERE keyId AND accountId in one statement) rather than find-then-update --
   * avoids a TOCTOU gap and means a `keyId` that genuinely doesn't exist and a `keyId` that
   * belongs to a different account both produce the exact same `affected: 0` result, so the
   * caller (controller) can't distinguish them either -- matches this repo's established
   * private-vs-never-existed indistinguishability discipline.
   */
  async revoke(accountId: string, keyId: string): Promise<boolean> {
    const result = await this.signingKeysRepo.update({ accountId, keyId }, { revokedAt: new Date() });
    return (result.affected ?? 0) > 0;
  }
}
