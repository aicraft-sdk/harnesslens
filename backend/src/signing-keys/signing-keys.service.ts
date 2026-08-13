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
}
