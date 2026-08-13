import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Repo } from '../repos/entities/repo.entity';
import { Submission } from '../submissions/entities/submission.entity';

export interface QueryResultRow {
  repoId: string;
  score: number;
  level: unknown;
  dimensions: unknown;
  frameworkMapping: unknown;
  commitSha: string;
  scannedAt: string;
  verified: boolean;
}

interface RawPublicLatestRow {
  repoId: string;
  score: string;
  level: unknown;
  dimensions: unknown;
  frameworkMapping: unknown;
  commitSha: string;
  scannedAt: Date;
  verified: boolean;
}

function toQueryResultRow(repoId: string, submission: Submission): QueryResultRow {
  return {
    repoId,
    score: Number(submission.score),
    level: submission.level,
    dimensions: submission.dimensions,
    frameworkMapping: submission.frameworkMapping,
    commitSha: submission.commitSha,
    scannedAt: submission.scannedAt.toISOString(),
    verified: submission.verified,
  };
}

@Injectable()
export class QueryService {
  constructor(
    @InjectRepository(Repo) private readonly reposRepo: Repository<Repo>,
    @InjectRepository(Submission) private readonly submissionsRepo: Repository<Submission>,
  ) {}

  /**
   * Latest submission per public repoId, pushed into the DB query (DISTINCT ON) rather than
   * app-layer aggregation, per Phase 2's Task 2.1 -- this runs per-request over a potentially
   * large table, unlike `buildLeaderboard`'s pure in-memory dedup which reads a bounded set of
   * files.
   */
  async listPublicLatest(): Promise<QueryResultRow[]> {
    const rows: RawPublicLatestRow[] = await this.submissionsRepo.query(`
      SELECT DISTINCT ON (s.repo_id)
        r.repo_id AS "repoId",
        s.score AS "score",
        s.level AS "level",
        s.dimensions AS "dimensions",
        s.framework_mapping AS "frameworkMapping",
        s.commit_sha AS "commitSha",
        s.scanned_at AS "scannedAt",
        s.verified AS "verified"
      FROM submissions s
      INNER JOIN repos r ON r.id = s.repo_id
      WHERE r.visibility = 'public'
      ORDER BY s.repo_id, s.scanned_at DESC
    `);
    return rows.map((row) => ({
      repoId: row.repoId,
      score: Number(row.score),
      level: row.level,
      dimensions: row.dimensions,
      frameworkMapping: row.frameworkMapping,
      commitSha: row.commitSha,
      scannedAt: row.scannedAt.toISOString(),
      verified: row.verified,
    }));
  }

  /**
   * Resolves to `null` both when no repo exists for `repoId` and when the repo exists but is
   * private -- callers must treat both the same way (404, identical shape) so an unauthenticated
   * caller can never distinguish "private" from "never existed".
   */
  async getLatestForRepo(repoId: string): Promise<QueryResultRow | null> {
    const repo = await this.reposRepo.findOneBy({ repoId, visibility: 'public' });
    if (!repo) {
      return null;
    }
    const submission = await this.submissionsRepo.findOne({
      where: { repoId: repo.id },
      order: { scannedAt: 'DESC' },
    });
    if (!submission) {
      return null;
    }
    return toQueryResultRow(repoId, submission);
  }

  /** Same null-for-private-or-missing contract as `getLatestForRepo`; newest submission first. */
  async getHistoryForRepo(repoId: string): Promise<QueryResultRow[] | null> {
    const repo = await this.reposRepo.findOneBy({ repoId, visibility: 'public' });
    if (!repo) {
      return null;
    }
    const submissions = await this.submissionsRepo.find({
      where: { repoId: repo.id },
      order: { scannedAt: 'DESC' },
    });
    return submissions.map((submission) => toQueryResultRow(repoId, submission));
  }
}
