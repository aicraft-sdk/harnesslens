import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReportFromScanContext, corePack, createScanContext } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../test/fixtures');

const LEVEL_FIXTURES = [
  { dir: 'level-0', expectedLevel: 0 },
  { dir: 'level-1', expectedLevel: 1 },
  { dir: 'level-2', expectedLevel: 2 },
  { dir: 'level-3', expectedLevel: 3 },
  { dir: 'level-4', expectedLevel: 4 },
];

describe('core pack parity with reference fixtures', () => {
  it('exposes exactly the 36 checks in the core pack', () => {
    expect(corePack.id).toBe('core');
    expect(corePack.checks).toHaveLength(36);
  });

  for (const { dir, expectedLevel } of LEVEL_FIXTURES) {
    it(`scores ${dir} at maturity level ${expectedLevel}`, () => {
      const root = path.join(FIXTURES_ROOT, dir);
      const ctx = createScanContext(root);
      const report = buildReportFromScanContext(ctx);
      expect(report.level.index).toBe(expectedLevel);
    });
  }
});
