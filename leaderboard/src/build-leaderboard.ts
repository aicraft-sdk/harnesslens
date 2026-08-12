/**
 * Pure aggregation over parsed submissions. No fs/network/Date.now() in this
 * file — the impure shell (cli.ts, Phase 4) owns all of that.
 */
import { parseSubmission } from './parse-submission.js';
import { STALE_THRESHOLD_DAYS } from './types.js';
import type { LeaderboardEntry, RawSubmissionFile, ValidatedSubmission } from './types.js';

export interface SkippedEntry {
  file: string;
  reason: string;
}

export interface BuildLeaderboardResult {
  valid: LeaderboardEntry[];
  skipped: SkippedEntry[];
}

function isStale(scannedAt: string): boolean {
  const ageMs = Date.now() - Date.parse(scannedAt);
  return ageMs > STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

export function buildLeaderboard(files: RawSubmissionFile[]): BuildLeaderboardResult {
  const parsed: Array<{ file: string; entry: ValidatedSubmission }> = [];
  const skipped: SkippedEntry[] = [];

  for (const { file, raw } of files) {
    const result = parseSubmission(raw, file);
    if (result.ok) parsed.push({ file, entry: result.entry });
    else skipped.push({ file: result.file, reason: result.reason });
  }

  const byRepoId = new Map<string, { file: string; entry: ValidatedSubmission }>();
  for (const candidate of parsed) {
    const existing = byRepoId.get(candidate.entry.repoId);
    if (!existing) {
      byRepoId.set(candidate.entry.repoId, candidate);
      continue;
    }
    const candidateNewer =
      Date.parse(candidate.entry.scannedAt) > Date.parse(existing.entry.scannedAt) ||
      (Date.parse(candidate.entry.scannedAt) === Date.parse(existing.entry.scannedAt) &&
        candidate.file > existing.file);
    if (candidateNewer) {
      byRepoId.set(candidate.entry.repoId, candidate);
      skipped.push({ file: existing.file, reason: `superseded by newer submission for ${candidate.entry.repoId}` });
    } else {
      skipped.push({ file: candidate.file, reason: `superseded by newer submission for ${existing.entry.repoId}` });
    }
  }

  const valid: LeaderboardEntry[] = [...byRepoId.values()]
    .sort((a, b) => a.entry.repoId.localeCompare(b.entry.repoId))
    .map(({ entry }) => ({ ...entry, stale: isStale(entry.scannedAt) }));

  return { valid, skipped };
}
