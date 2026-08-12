import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
