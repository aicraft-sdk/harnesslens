import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../test/fixtures');

describe('runCli', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-leaderboard-cli-'));
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('writes site-data.json from a submissions directory', () => {
    const code = runCli([FIXTURES, outDir]);
    expect(code).toBe(0);
    const dataPath = path.join(outDir, 'site-data.json');
    expect(fs.existsSync(dataPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    expect(typeof data.generatedAt).toBe('string');
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries.length).toBeGreaterThan(0);
  });

  it('never fails the whole build on a malformed submission file', () => {
    const code = runCli([FIXTURES, outDir]);
    expect(code).toBe(0); // FIXTURES includes malformed-missing-field.json — must not abort.
  });

  it('reports a distinct "JSON parse error" reason for a file with invalid JSON syntax, not the generic shape-failure reason (edge-case catalog #2, REM-FIX)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = runCli([FIXTURES, outDir]);
      expect(code).toBe(0); // still never fails the whole build.
      const messages = stderrSpy.mock.calls.map((call) => String(call[0]));
      const invalidJsonMessage = messages.find((m) => m.includes('invalid-json-syntax.json'));
      expect(invalidJsonMessage).toBeDefined();
      expect(invalidJsonMessage).toContain('JSON parse error');
      expect(invalidJsonMessage).not.toContain('submission is not a JSON object');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('returns a clean non-zero exit instead of throwing when the submissions directory does not exist (REM-FIX)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const missingDir = path.join(outDir, 'does-not-exist');
    try {
      let code: number | undefined;
      let thrown: unknown;
      try {
        code = runCli([missingDir, outDir]);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeUndefined();
      expect(code).not.toBe(0);
      const messages = stderrSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.startsWith('harness-audit-leaderboard: '))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('skips a file that cannot be read (e.g. EISDIR from a directory literally named *.json) instead of crashing the whole rebuild (REM-FIX round 2)', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      let code: number | undefined;
      let thrown: unknown;
      try {
        code = runCli([FIXTURES, outDir]);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeUndefined();
      expect(code).toBe(0); // FIXTURES includes unreadable-directory.json — must not abort.
      const dataPath = path.join(outDir, 'site-data.json');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.entries.length).toBeGreaterThan(0);
      const messages = stderrSpy.mock.calls.map((call) => String(call[0]));
      const unreadableMessage = messages.find((m) => m.includes('unreadable-directory.json'));
      expect(unreadableMessage).toBeDefined();
      expect(unreadableMessage).toContain('cannot read file');
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
