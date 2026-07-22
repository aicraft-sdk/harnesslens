/**
 * Standalone multi-repo runner — Phase 4. Loops over N local repo paths,
 * calling the existing `runAudit` (api.ts) once per repo, and aggregates the
 * results into a rollup useful for comparing repos ("here's how our repos
 * compare"). Deliberately NOT built on `@ai-craft/repo-conductor` (router
 * decision — repo-conductor is a Docker/Postgres/RabbitMQ live-agent
 * dispatcher, a complexity mismatch for looping over local filesystem scans).
 *
 * Determinism (explicit exit criterion): no `Date.now()`/random ids/unstable
 * key ordering anywhere in this file. `Promise.all` preserves result order
 * matching the input `entries` order regardless of individual scan timing,
 * and `computeRollup` only does deterministic arithmetic + insertion-ordered
 * object construction — running the same repo paths twice must produce
 * byte-identical JSON output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runAudit } from './api.js';
import { LEVEL_NAMES, TOOL_VERSION } from './score.js';
import type { Report } from './types.js';

export interface RepoEntry {
  id: string;
  path: string;
}

/**
 * `report` is `null` when this repo's audit failed — `error` then carries the
 * failure reason. Exactly one of `report`/`error` is meaningful per entry.
 */
export interface RepoAuditResult {
  id: string;
  path: string;
  report: Report | null;
  error?: string;
}

export interface MultiRepoRollup {
  /** Count of SUCCESSFUL audits only — failed entries are excluded from every average below. */
  repoCount: number;
  averageScorePercent: number;
  averageLevelIndex: number;
  levelCounts: Record<string, number>;
  /** Count of repos whose audit threw — see each entry's `error` in `results` for why. */
  failedCount: number;
}

export interface MultiRepoReport {
  tool: { name: string; version: string };
  results: RepoAuditResult[];
  rollup: MultiRepoRollup;
}

function computeRollup(results: RepoAuditResult[]): MultiRepoRollup {
  const levelCounts: Record<string, number> = {};
  for (const name of LEVEL_NAMES) levelCounts[name] = 0;

  const successes = results.filter(
    (r): r is RepoAuditResult & { report: Report } => r.report !== null,
  );
  const failedCount = results.length - successes.length;
  const repoCount = successes.length;
  if (repoCount === 0) {
    return { repoCount: 0, averageScorePercent: 0, averageLevelIndex: 0, levelCounts, failedCount };
  }

  let scoreSum = 0;
  let levelSum = 0;
  for (const { report } of successes) {
    scoreSum += report.score.percent;
    levelSum += report.level.index;
    levelCounts[report.level.name] = (levelCounts[report.level.name] ?? 0) + 1;
  }

  return {
    repoCount,
    averageScorePercent: Math.round((scoreSum / repoCount) * 100) / 100,
    averageLevelIndex: Math.round((levelSum / repoCount) * 100) / 100,
    levelCounts,
    failedCount,
  };
}

/**
 * Audit each repo entry (in parallel — pure local fs scanning, no rate limits
 * to worry about) and aggregate a rollup. Uses `Promise.allSettled` (not
 * `Promise.all`) so that one bad entry (bad path, malformed
 * `.harness-audit.json`, a failed pack import, etc.) reports as a per-entry
 * failure instead of aborting the whole fleet scan — mirroring `score.ts`'s
 * `runChecks`, which already isolates failures at the individual-check level.
 */
export async function runMultiRepoAudit(entries: RepoEntry[]): Promise<MultiRepoReport> {
  const settled = await Promise.allSettled(entries.map((entry) => runAudit({ root: entry.path })));

  const results: RepoAuditResult[] = settled.map((outcome, i) => {
    const entry = entries[i]!;
    if (outcome.status === 'fulfilled') {
      return { id: entry.id, path: entry.path, report: outcome.value };
    }
    return {
      id: entry.id,
      path: entry.path,
      report: null,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });

  return {
    tool: { name: 'harness-audit', version: TOOL_VERSION },
    results,
    rollup: computeRollup(results),
  };
}

interface RepoManifestEntry {
  id?: unknown;
  path?: unknown;
}

interface RepoManifestFile {
  repos?: RepoManifestEntry[];
}

/** Load a small JSON manifest of `{ "repos": [{ "id", "path" }] }`; relative paths resolve against the manifest file's directory. */
export function loadRepoManifest(manifestPath: string): RepoEntry[] {
  const absManifestPath = path.resolve(manifestPath);
  const text = fs.readFileSync(absManifestPath, 'utf8');
  const parsed = JSON.parse(text) as RepoManifestFile;

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.repos)) {
    throw new Error(`${manifestPath}: expected { "repos": [{ "id": "...", "path": "..." }] }`);
  }

  const manifestDir = path.dirname(absManifestPath);
  return parsed.repos.map((entry, i) => {
    if (typeof entry.id !== 'string' || typeof entry.path !== 'string') {
      throw new Error(`${manifestPath}: repos[${i}] must be an object with string "id" and "path".`);
    }
    return { id: entry.id, path: path.isAbsolute(entry.path) ? entry.path : path.resolve(manifestDir, entry.path) };
  });
}
