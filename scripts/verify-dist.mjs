#!/usr/bin/env node
// Smoke-checks the build output so a broken tsconfig `rootDir` (or any other
// misconfiguration that nests dist output instead of producing a flat layout)
// fails the build loudly instead of silently shipping a broken package.
// See: leaderboard/tsconfig.lib.json missing rootDir incident (dist/leaderboard/src/cli.js
// instead of dist/cli.js, build still exited 0).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, 'dist');

// Matches package.json's main/bin/exports + the LICENSE fix from copy-assets.mjs.
const expected = ['index.js', 'cli.js', 'LICENSE'];

const missing = expected.filter((file) => !existsSync(path.join(distDir, file)));

if (missing.length > 0) {
  console.error(
    `verify-dist: expected flat dist/ output missing: ${missing.join(', ')}\n` +
      `  Check tsconfig.lib.json's "rootDir" and copy-assets.mjs's asset list.`
  );
  process.exit(1);
}

console.log(`verify-dist: confirmed ${expected.length} expected file(s) present flat in dist/`);
