/**
 * Regression guard for the `isMainModule()` symlink bug that shipped in the published,
 * permanently-broken `harnesslens@0.0.1` (fixed in `src/cli.ts` at commit 9f76254).
 *
 * All other `cli.spec.ts` tests call `main(argv, io)` directly, which bypasses
 * `isMainModule()` entirely — that is exactly how the original bug reached a published
 * package with a fully green test suite. This test is the only one that actually
 * exercises the real `node <bin>` invocation path through a symlink (the way npm's
 * `bin` field, `npx`, and global installs all invoke the CLI), so it is the load-bearing
 * regression guard for that class of bug.
 *
 * `isMainModule()` itself is not exported (it depends on the live process's
 * `process.argv`/`import.meta.url`, which makes it awkward to unit-test directly without
 * restructuring `cli.ts` purely for testability — not done here, see plan notes). This
 * integration-style test is the primary and sufficient regression guard.
 */
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIST = path.resolve(__dirname, '../dist/cli.js');
const distExists = fs.existsSync(CLI_DIST);

if (!distExists) {
  // eslint-disable-next-line no-console
  console.warn(
    `[cli-symlink.spec.ts] Skipping symlink regression test: ${CLI_DIST} does not exist yet. Run \`npm run build\` first.`,
  );
}

describe('cli symlink invocation (regression: isMainModule must resolve symlinks)', () => {
  let tmpDir: string | undefined;

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!distExists)(
    'prints the HELP banner and exits 0 when the built CLI is invoked through a real symlink (the way npm bin/npx/global installs invoke it)',
    () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-cli-symlink-'));
      const symlinkPath = path.join(tmpDir, 'harnesslens');
      fs.symlinkSync(CLI_DIST, symlinkPath);

      const result = cp.spawnSync(process.execPath, [symlinkPath, '--help'], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stdout).toContain('harnesslens');
      expect(result.stdout).toContain('Usage:');
    },
  );
});
