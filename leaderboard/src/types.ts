/** Submission/leaderboard data shapes for harnesslens-leaderboard. Internal, not published. */

export const STALE_THRESHOLD_DAYS = 90;

export interface RawSubmissionFile {
  file: string;
  raw: unknown;
}

/** The exact 7-field allowlist a submission may contribute. Never widen this via spread. */
export interface ValidatedSubmission {
  repoId: string;
  score: number;
  level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
  frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  commitSha: string;
  scannedAt: string;
}

export interface LeaderboardEntry extends ValidatedSubmission {
  stale: boolean;
}

export interface LeaderboardSiteData {
  generatedAt: string;
  entries: LeaderboardEntry[];
}
