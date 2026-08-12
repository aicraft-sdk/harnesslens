#!/usr/bin/env node
/** Impure shell: reads submissions/, calls the pure buildLeaderboard, writes site-data.json. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLeaderboard } from './build-leaderboard.js';
import type { RawSubmissionFile } from './types.js';

export function runCli(argv: string[]): number {
  const submissionsDir = path.resolve(argv[0] ?? 'submissions');
  const outDir = path.resolve(argv[1] ?? 'publish');

  const filenames = fs
    .readdirSync(submissionsDir)
    .filter((f) => f.endsWith('.json'))
    .sort(); // deterministic input order — see P5.

  const files: RawSubmissionFile[] = filenames.map((file) => {
    const text = fs.readFileSync(path.join(submissionsDir, file), 'utf8');
    try {
      return { file, raw: JSON.parse(text) as unknown };
    } catch {
      return { file, raw: null }; // parseSubmission rejects null as "not an object" — logged below.
    }
  });

  const { valid, skipped } = buildLeaderboard(files);
  for (const { file, reason } of skipped) {
    process.stderr.write(`harness-audit-leaderboard: skipped ${file}: ${reason}\n`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'site-data.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), entries: valid }, null, 2),
  );

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
