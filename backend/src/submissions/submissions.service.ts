import { Injectable } from '@nestjs/common';
import { isDangerousKey } from '../common/dangerous-keys';
import type { CreateSubmissionDto } from './dto/create-submission.dto';

export interface InsertableSubmissionRow {
  repoId: string;
  score: number;
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
  | { ok: true; row: InsertableSubmissionRow }
  | { ok: false; reason: string };

@Injectable()
export class SubmissionsService {
  /**
   * Reconstructs the insertable row field-by-field from the validated DTO -- never `{ ...dto }`.
   * dimensions[].id dangerous keys are fail-closed (reject the whole submission); frameworkMapping
   * dangerous keys are fail-open (skip only that one entry), matching leaderboard/parse-submission's
   * documented split.
   */
  buildInsertableSubmission(dto: CreateSubmissionDto, repoUuid: string): BuildInsertableSubmissionResult {
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
      frameworkMapping[key] = { nistFunctions: value.nistFunctions, owaspIds: value.owaspIds };
    }

    const row: InsertableSubmissionRow = {
      repoId: repoUuid,
      score: dto.score,
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
