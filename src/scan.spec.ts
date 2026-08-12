import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScanContext } from './scan.js';

describe('createScanContext — root readability', () => {
  it('throws a clear error when the root does not exist', () => {
    const missingRoot = path.join(os.tmpdir(), 'harnesslens-does-not-exist-xyz');

    expect(() => createScanContext(missingRoot)).toThrow(
      /harnesslens: repository root not found or not readable/,
    );
  });

  describe('a real, existing, readable, but genuinely empty directory', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-empty-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does NOT throw and returns a normal empty, untruncated context', () => {
      const ctx = createScanContext(dir);

      expect(ctx.files).toEqual([]);
      expect(ctx.truncated).toBe(false);
    });
  });
});
