import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { isDangerousKey } from '../common/dangerous-keys';
import { SigningKey } from '../signing-keys/entities/signing-key.entity';
import { buildCanonicalPayload } from '../signing/canonical-payload';
import { verifyEd25519 } from '../signing/ed25519';
import type { CreateSubmissionDto } from './dto/create-submission.dto';

// `repoId` is deliberately not part of this shape: it is the auto-provisioned repo's resolved
// UUID, only known *after* `ReposService.findOrCreateForSubmission` runs -- a side-effecting,
// permanent DB write. Keeping it out of `buildInsertableSubmission`'s return type lets validation
// run standalone, before that provisioning side effect, so a rejected submission never leaves an
// orphaned `accounts`/`repos` row behind. The caller (`SubmissionsController.create`) attaches the
// resolved `repoId` only once validation has already passed.
export interface InsertableSubmissionFields {
  // The submissions.score column is Postgres `numeric`, which TypeORM maps to `string` in JS to
  // avoid float precision loss -- converted from the DTO's validated number here.
  score: string;
  level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
  frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  commitSha: string;
  scannedAt: Date;
  verified: boolean;
  signature: string | null;
  keyId: string | null;
}

export type BuildInsertableSubmissionResult =
  | { ok: true; row: InsertableSubmissionFields }
  | { ok: false; reason: string };

const INVALID_SIGNATURE_REASON = 'invalid signature';

@Injectable()
export class SubmissionsService {
  constructor(@InjectRepository(SigningKey) private readonly signingKeysRepo: Repository<SigningKey>) {}

  /**
   * Reconstructs the insertable row field-by-field from the validated DTO -- never `{ ...dto }`.
   * dimensions[].id dangerous keys are fail-closed (reject the whole submission); frameworkMapping
   * dangerous keys are fail-open (skip only that one entry), matching leaderboard/parse-submission's
   * documented split. Deliberately takes no `repoId`/repo-provisioning dependency -- this must be
   * safely callable before `ReposService.findOrCreateForSubmission`'s side-effecting write runs
   * (see `InsertableSubmissionFields` note above). It does now depend on `signing_keys` lookups
   * (read-only) for verified-tier submissions -- a read has no orphaning side effect, so this does
   * not reintroduce the validate-before-provision ordering risk.
   */
  async buildInsertableSubmission(dto: CreateSubmissionDto): Promise<BuildInsertableSubmissionResult> {
    for (const dimension of dto.dimensions) {
      if (isDangerousKey(dimension.id)) {
        return { ok: false, reason: `dimensions contains a dangerous key: ${dimension.id}` };
      }
    }

    const frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }> = {};
    for (const [key, value] of Object.entries(dto.frameworkMapping)) {
      if (isDangerousKey(key)) {
        continue; // fail-open: skip the one bad entry, keep the rest
      }
      // Minimal shape check: class-validator can't natively validate this arbitrary-key record
      // (see Task 1.1's DTO note), so a malformed entry like `{ ci: {} }` would otherwise be
      // copied through as `{ nistFunctions: undefined, owaspIds: undefined }` with no rejection.
      // Skip-and-continue the one malformed entry, matching this field's existing fail-open rule.
      if (!Array.isArray(value?.nistFunctions) || !Array.isArray(value?.owaspIds)) {
        continue;
      }
      frameworkMapping[key] = { nistFunctions: value.nistFunctions, owaspIds: value.owaspIds };
    }

    const reconstructedDimensions = dto.dimensions.map((d) => ({
      id: d.id,
      title: d.title,
      earned: d.earned,
      max: d.max,
      percent: d.percent,
    }));

    const row: InsertableSubmissionFields = {
      score: String(dto.score),
      level: { index: dto.level.index, name: dto.level.name },
      dimensions: reconstructedDimensions,
      frameworkMapping,
      commitSha: dto.commitSha,
      scannedAt: new Date(dto.scannedAt),
      verified: false,
      signature: null,
      keyId: null,
    };

    // Verified tier (Phase 3): only present when the submitter signed the payload with a
    // registered Ed25519 key. A bad signature must be rejected outright (400, not persisted) --
    // never silently downgraded to an unsigned, unverified-but-still-accepted submission.
    if (dto.keyId !== undefined) {
      if (dto.signature === undefined) {
        return { ok: false, reason: INVALID_SIGNATURE_REASON };
      }

      const verified = await this.verifySignedSubmission(dto, reconstructedDimensions, frameworkMapping);
      if (!verified) {
        return { ok: false, reason: INVALID_SIGNATURE_REASON };
      }

      row.verified = true;
      row.signature = dto.signature;
      row.keyId = dto.keyId;
    }

    return { ok: true, row };
  }

  /**
   * Verifies fails closed for any reason (unknown key, revoked key, bad signature) -- the caller
   * always sees the same generic rejection either way, so a failed verification attempt cannot be
   * used as an oracle to distinguish "no such key" from "wrong signature". The canonical payload
   * is always server-reconstructed here from the already-validated/-reconstructed fields (Durable
   * Decision 10) -- `verifyEd25519` is never called with a client-supplied canonical string.
   */
  private async verifySignedSubmission(
    dto: CreateSubmissionDto,
    dimensions: InsertableSubmissionFields['dimensions'],
    frameworkMapping: InsertableSubmissionFields['frameworkMapping'],
  ): Promise<boolean> {
    const signingKey = await this.signingKeysRepo.findOneBy({ keyId: dto.keyId });
    if (!signingKey || signingKey.revokedAt !== null) {
      return false;
    }

    const canonicalPayload = buildCanonicalPayload({
      repoId: dto.repoId,
      score: dto.score,
      level: { index: dto.level.index, name: dto.level.name },
      dimensions,
      frameworkMapping,
      commitSha: dto.commitSha,
      scannedAt: dto.scannedAt,
    });

    try {
      return verifyEd25519(signingKey.publicKey, canonicalPayload, dto.signature as string);
    } catch {
      // Any verification failure (malformed key/signature bytes, etc.) fails closed.
      return false;
    }
  }
}
