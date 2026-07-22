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
    expect(result.results[0]!.report.level.index).toBe(0);
    expect(result.results[1]!.report.level.index).toBe(4);

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

describe('loadRepoManifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-manifest-'));
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
