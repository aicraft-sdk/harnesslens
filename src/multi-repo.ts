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

export interface RepoAuditResult {
  id: string;
  path: string;
  report: Report;
}

export interface MultiRepoRollup {
  repoCount: number;
  averageScorePercent: number;
  averageLevelIndex: number;
  levelCounts: Record<string, number>;
}

export interface MultiRepoReport {
  tool: { name: string; version: string };
  results: RepoAuditResult[];
  rollup: MultiRepoRollup;
}

function computeRollup(results: RepoAuditResult[]): MultiRepoRollup {
  const levelCounts: Record<string, number> = {};
  for (const name of LEVEL_NAMES) levelCounts[name] = 0;

  const repoCount = results.length;
  if (repoCount === 0) {
    return { repoCount: 0, averageScorePercent: 0, averageLevelIndex: 0, levelCounts };
  }

  let scoreSum = 0;
  let levelSum = 0;
  for (const { report } of results) {
    scoreSum += report.score.percent;
    levelSum += report.level.index;
    levelCounts[report.level.name] = (levelCounts[report.level.name] ?? 0) + 1;
  }

  return {
    repoCount,
    averageScorePercent: Math.round((scoreSum / repoCount) * 100) / 100,
    averageLevelIndex: Math.round((levelSum / repoCount) * 100) / 100,
    levelCounts,
  };
}

/** Audit each repo entry (in parallel — pure local fs scanning, no rate limits to worry about) and aggregate a rollup. */
export async function runMultiRepoAudit(entries: RepoEntry[]): Promise<MultiRepoReport> {
  const results = await Promise.all(
    entries.map(
      async (entry): Promise<RepoAuditResult> => ({
        id: entry.id,
        path: entry.path,
        report: await runAudit({ root: entry.path }),
      }),
    ),
  );

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
