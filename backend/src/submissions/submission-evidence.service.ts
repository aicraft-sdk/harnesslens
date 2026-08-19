import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import type { Repository } from 'typeorm';
import { Submission } from './entities/submission.entity';
import { SigningKey } from '../signing-keys/entities/signing-key.entity';

export interface SubmissionEvidence {
  id: string;
  repoId: string;
  score: number;
  level: unknown;
  dimensions: unknown;
  checks: unknown;
  frameworkMapping: unknown;
  commitSha: string;
  scannedAt: string;
  verified: boolean;
  signature: string | null;
  keyId: string | null;
  publicKey: string | null;
}

@Injectable()
export class SubmissionEvidenceService {
  constructor(
    @InjectRepository(Submission) private readonly submissionsRepo: Repository<Submission>,
    @InjectRepository(SigningKey) private readonly signingKeysRepo: Repository<SigningKey>,
  ) {}

  /**
   * Returns null for: unknown id, malformed (non-UUID) id (Durable Decision 8 -- never 500s), and
   * a private repo's submission when requestingAccountId doesn't own it (Durable Decision 7) --
   * all three are intentionally indistinguishable to the caller (404 either way at the controller).
   *
   * Note: a submission whose signing key was later revoked still returns its historical
   * signature/payload/publicKey as originally stored -- revocation is not retroactive here (see
   * the plan's Edge-case catalog); this endpoint never checks `revokedAt`.
   */
  async getEvidence(id: string, requestingAccountId: string | undefined): Promise<SubmissionEvidence | null> {
    if (!isUUID(id)) {
      return null;
    }

    const submission = await this.submissionsRepo.findOne({ where: { id }, relations: ['repo'] });
    if (!submission?.repo) {
      return null;
    }
    if (submission.repo.visibility === 'private' && submission.repo.accountId !== requestingAccountId) {
      return null;
    }

    let publicKey: string | null = null;
    if (submission.keyId) {
      const key = await this.signingKeysRepo.findOneBy({ keyId: submission.keyId });
      publicKey = key?.publicKey ?? null;
    }

    // Explicit field whitelist -- never `{ ...submission }` (never leak repo_id UUID, internal
    // relation objects, submittedAt, or any future entity field by accident).
    return {
      id: submission.id,
      repoId: submission.repo.repoId,
      score: Number(submission.score),
      level: submission.level,
      dimensions: submission.dimensions,
      checks: submission.checks ?? null,
      frameworkMapping: submission.frameworkMapping,
      commitSha: submission.commitSha,
      scannedAt: submission.scannedAt.toISOString(),
      verified: submission.verified,
      signature: submission.signature,
      keyId: submission.keyId,
      publicKey,
    };
  }
}
