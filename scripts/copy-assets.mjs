#!/usr/bin/env node
// Copies publish-time assets into dist/, mirroring the Nx @nx/js:tsc "assets" list
// this package previously relied on (plus the missing LICENSE fix — see plan
// Durable Decision #3 / Task 4.5).
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, 'dist');

const files = [
  'README.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'NOTICE',
  'LICENSE',
  'package.json',
];

const dirs = ['THIRD_PARTY_LICENSES'];

async function main() {
  await mkdir(distDir, { recursive: true });

  for (const file of files) {
    const src = path.join(rootDir, file);
    if (!existsSync(src)) {
      throw new Error(`copy-assets: expected asset missing: ${file}`);
    }
    await cp(src, path.join(distDir, file));
  }

  for (const dir of dirs) {
    const src = path.join(rootDir, dir);
    if (!existsSync(src)) {
      throw new Error(`copy-assets: expected asset dir missing: ${dir}`);
    }
    await cp(src, path.join(distDir, dir), { recursive: true });
  }

  console.log(`copy-assets: copied ${files.length} files + ${dirs.length} dir(s) into ${distDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
