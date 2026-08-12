import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRepoManifest, runMultiRepoAudit } from './multi-repo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../test/fixtures');
const LEVEL_0_FIXTURE = path.join(FIXTURES_ROOT, 'level-0');
const LEVEL_4_FIXTURE = path.join(FIXTURES_ROOT, 'level-4');

describe('runMultiRepoAudit — aggregate over 2+ repos', () => {
  it('returns per-repo reports plus a rollup summarizing all repos', async () => {
    const result = await runMultiRepoAudit([
      { id: 'repo-zero', path: LEVEL_0_FIXTURE },
      { id: 'repo-four', path: LEVEL_4_FIXTURE },
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ id: 'repo-zero', path: LEVEL_0_FIXTURE });
    expect(result.results[1]).toMatchObject({ id: 'repo-four', path: LEVEL_4_FIXTURE });
    expect(result.results[0]!.report!.level.index).toBe(0);
    expect(result.results[1]!.report!.level.index).toBe(4);

    expect(result.rollup.repoCount).toBe(2);
    expect(result.rollup.averageLevelIndex).toBe(2);
    expect(result.rollup.levelCounts['Unharnessed']).toBe(1);
    expect(result.rollup.levelCounts['Self-correcting']).toBe(1);
  });

  it('produces byte-identical JSON output across two separate invocations (determinism)', async () => {
    const entries = [
      { id: 'repo-zero', path: LEVEL_0_FIXTURE },
      { id: 'repo-four', path: LEVEL_4_FIXTURE },
    ];

    const first = await runMultiRepoAudit(entries);
    const second = await runMultiRepoAudit(entries);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('runMultiRepoAudit — per-repo failure isolation', () => {
  const BAD_PATH = path.join(FIXTURES_ROOT, 'this-repo-does-not-exist');

  it('isolates one bad entry from the rest — good repos still report, bad one reports a failure, function does not reject', async () => {
    const result = await runMultiRepoAudit([
      { id: 'repo-zero', path: LEVEL_0_FIXTURE },
      { id: 'repo-bad', path: BAD_PATH },
      { id: 'repo-four', path: LEVEL_4_FIXTURE },
    ]);

    expect(result.results).toHaveLength(3);

    const zero = result.results[0]!;
    expect(zero.id).toBe('repo-zero');
    expect(zero.report).not.toBeNull();
    expect(zero.report!.level.index).toBe(0);

    const bad = result.results[1]!;
    expect(bad.id).toBe('repo-bad');
    expect(bad.report).toBeNull();
    expect(bad.error).toMatch(/repository root not found or not readable/);

    const four = result.results[2]!;
    expect(four.id).toBe('repo-four');
    expect(four.report).not.toBeNull();
    expect(four.report!.level.index).toBe(4);

    // The failed entry must not corrupt the average — only successes count.
    expect(result.rollup.repoCount).toBe(2);
    expect(result.rollup.averageLevelIndex).toBe(2);
    expect(result.rollup.failedCount).toBe(1);
  });

  it('produces byte-identical JSON output across two runs of a mixed good/bad fleet (determinism)', async () => {
    const entries = [
      { id: 'repo-zero', path: LEVEL_0_FIXTURE },
      { id: 'repo-bad', path: BAD_PATH },
      { id: 'repo-four', path: LEVEL_4_FIXTURE },
    ];

    const first = await runMultiRepoAudit(entries);
    const second = await runMultiRepoAudit(entries);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('loadRepoManifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a JSON manifest and resolves relative repo paths against the manifest directory', () => {
    const manifestPath = path.join(dir, 'repos.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ repos: [{ id: 'a', path: './some-repo' }] }));

    const entries = loadRepoManifest(manifestPath);

    expect(entries).toEqual([{ id: 'a', path: path.join(dir, 'some-repo') }]);
  });

  it('throws a clear error when a repo entry is missing "id" or "path"', () => {
    const manifestPath = path.join(dir, 'bad.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ repos: [{ id: 'a' }] }));

    expect(() => loadRepoManifest(manifestPath)).toThrow(/repos\[0\]/);
  });
});
