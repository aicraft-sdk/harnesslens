// leaderboard/src/build-leaderboard.spec.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLeaderboard } from './build-leaderboard.js';
import type { RawSubmissionFile } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../test/fixtures');

function loadFixture(name: string): RawSubmissionFile {
  return { file: name, raw: JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) };
}

describe('buildLeaderboard', () => {
  it('returns empty valid/skipped for an empty input list', () => {
    expect(buildLeaderboard([])).toEqual({ valid: [], skipped: [] });
  });

  it('flags a stale submission without excluding it', () => {
    const { valid, skipped } = buildLeaderboard([loadFixture('stale-repo.json')]);
    expect(skipped).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.stale).toBe(true);
  });

  it('skips a malformed submission with a reason, does not throw', () => {
    const { valid, skipped } = buildLeaderboard([loadFixture('malformed-missing-field.json')]);
    expect(valid).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toContain('commitSha');
  });

  it('dedupes a repeated repoId, keeping the freshest scannedAt (P3: total accounting)', () => {
    const files = [loadFixture('duplicate-repo-old.json'), loadFixture('duplicate-repo-new.json')];
    const { valid, skipped } = buildLeaderboard(files);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.commitSha).toBe(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'duplicate-repo-new.json'), 'utf8')).commitSha);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/superseded/i);
    expect(valid.length + skipped.length).toBe(files.length);
  });

  it('ignores extraneous/hostile keys via the parser (mass-assignment defense)', () => {
    const { valid } = buildLeaderboard([loadFixture('mass-assignment.json')]);
    expect(valid).toHaveLength(1);
    expect(Object.keys(valid[0]!)).not.toContain('isAdmin');
  });

  it('is deterministic across two runs on the same input (P5)', () => {
    const files = [loadFixture('valid-repo-a.json'), loadFixture('stale-repo.json')];
    const first = JSON.stringify(buildLeaderboard(files).valid);
    const second = JSON.stringify(buildLeaderboard(files).valid);
    expect(first).toBe(second);
  });
});
