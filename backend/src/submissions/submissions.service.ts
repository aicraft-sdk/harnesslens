import { Injectable } from '@nestjs/common';
import { isDangerousKey } from '../common/dangerous-keys';
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

@Injectable()
export class SubmissionsService {
  /**
   * Reconstructs the insertable row field-by-field from the validated DTO -- never `{ ...dto }`.
   * dimensions[].id dangerous keys are fail-closed (reject the whole submission); frameworkMapping
   * dangerous keys are fail-open (skip only that one entry), matching leaderboard/parse-submission's
   * documented split. Deliberately takes no `repoId`/DB dependency -- this must be safely callable
   * before any repo-provisioning side effect runs (see `InsertableSubmissionFields` note above).
   */
  buildInsertableSubmission(dto: CreateSubmissionDto): BuildInsertableSubmissionResult {
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

    const row: InsertableSubmissionFields = {
      score: String(dto.score),
      level: { index: dto.level.index, name: dto.level.name },
      dimensions: dto.dimensions.map((d) => ({
        id: d.id,
        title: d.title,
        earned: d.earned,
        max: d.max,
        percent: d.percent,
      })),
      frameworkMapping,
      commitSha: dto.commitSha,
      scannedAt: new Date(dto.scannedAt),
      verified: false,
      signature: null,
      keyId: null,
    };

    return { ok: true, row };
  }
}
