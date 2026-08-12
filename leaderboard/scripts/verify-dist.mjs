#!/usr/bin/env node
// Smoke-checks the build output so a broken tsconfig `rootDir` (or any other
// misconfiguration that nests dist output instead of producing a flat layout)
// fails the build loudly instead of silently shipping a broken CLI entry point.
// See: this file's tsconfig.lib.json was previously missing rootDir, producing
// dist/leaderboard/src/cli.js instead of dist/cli.js while `npm run build` still
// exited 0 — silently breaking the documented `node dist/cli.js <submissionsDir> <outDir>`
// invocation.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, 'dist');

// leaderboard has no main/bin/exports in package.json; dist/cli.js is the only
// load-bearing output — it's the documented entry point for the CLI invocation.
const expected = ['cli.js'];

const missing = expected.filter((file) => !existsSync(path.join(distDir, file)));

if (missing.length > 0) {
  console.error(
    `verify-dist: expected flat dist/ output missing: ${missing.join(', ')}\n` +
      `  Check tsconfig.lib.json's "rootDir".`
  );
  process.exit(1);
}

console.log(`verify-dist: confirmed ${expected.length} expected file(s) present flat in dist/`);
