#!/usr/bin/env node
/** Impure shell: reads submissions/, calls the pure buildLeaderboard, writes site-data.json. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLeaderboard } from './build-leaderboard.js';
import type { RawSubmissionFile } from './types.js';
import type { SkippedEntry } from './build-leaderboard.js';

export function runCli(argv: string[]): number {
  const submissionsDir = path.resolve(argv[0] ?? 'submissions');
  const outDir = path.resolve(argv[1] ?? 'publish');

  let filenames: string[];
  try {
    filenames = fs
      .readdirSync(submissionsDir)
      .filter((f) => f.endsWith('.json'))
      .sort(); // deterministic input order — see P5.
  } catch (err) {
    process.stderr.write(
      `harnesslens-leaderboard: cannot read submissions directory ${submissionsDir}: ${(err as Error).message}\n`,
    );
    return 1;
  }

  const files: RawSubmissionFile[] = [];
  // Read and JSON-syntax failures are surfaced with their own reasons here (distinct from
  // parseSubmission's generic shape-failure reason) instead of being downgraded to `raw: null`
  // and re-diagnosed downstream — edge-case catalog #2. A single unreadable file (permission
  // denied, EISDIR from a directory literally named *.json, deleted between readdirSync and
  // readFileSync, a broken symlink) must never crash the whole rebuild — REM-FIX round 2.
  const preParseSkips: SkippedEntry[] = [];
  for (const file of filenames) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(submissionsDir, file), 'utf8');
    } catch (err) {
      preParseSkips.push({ file, reason: `cannot read file: ${(err as Error).message}` });
      continue;
    }
    try {
      files.push({ file, raw: JSON.parse(text) as unknown });
    } catch (err) {
      preParseSkips.push({ file, reason: `JSON parse error: ${(err as Error).message}` });
    }
  }

  const { valid, skipped } = buildLeaderboard(files);
  for (const { file, reason } of [...preParseSkips, ...skipped]) {
    process.stderr.write(`harnesslens-leaderboard: skipped ${file}: ${reason}\n`);
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'site-data.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), entries: valid }, null, 2),
    );
  } catch (err) {
    process.stderr.write(`harnesslens-leaderboard: cannot write output to ${outDir}: ${(err as Error).message}\n`);
    return 1;
  }

  return 0; // Design's Error Handling: malformed submissions never fail the whole rebuild.
}

function isMainModule(): boolean {
  try {
    if (typeof process.argv[1] !== 'string') return false;
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exit(runCli(process.argv.slice(2)));
}
