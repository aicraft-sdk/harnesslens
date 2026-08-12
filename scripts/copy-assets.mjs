#!/usr/bin/env node
// Copies publish-time assets into dist/, mirroring the Nx @nx/js:tsc "assets" list
// this package previously relied on (plus the missing LICENSE fix — see plan
// Durable Decision #3 / Task 4.5).
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, 'dist');

// Glob-based, matching Nx's original `assets: ["packages/harness-audit/*.md", ...]`
// behavior (see git show 70f2c01:packages/harness-audit/project.json) — so a future
// new root .md file isn't silently excluded from dist/.
const staticFiles = ['NOTICE', 'LICENSE', 'package.json'];

const dirs = ['THIRD_PARTY_LICENSES'];

async function main() {
  await mkdir(distDir, { recursive: true });

  const rootEntries = await readdir(rootDir, { withFileTypes: true });
  const mdFiles = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
  const files = [...mdFiles, ...staticFiles];

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
