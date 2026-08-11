import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReportFromScanContext, createScanContext, DOCS_BASE_URL } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../test/fixtures');

describe('DOCS_BASE_URL', () => {
  it('does not regress to the old upstream paladini/harness-score URL', () => {
    expect(DOCS_BASE_URL).not.toContain('paladini');
    expect(DOCS_BASE_URL).not.toContain('harness-score');
  });
});

describe('CheckResult.docsUrl', () => {
  it('is built from DOCS_BASE_URL plus the lowercased check id anchor for a real check produced by the scoring pipeline', () => {
    const root = path.join(FIXTURES_ROOT, 'level-0');
    const ctx = createScanContext(root);
    const report = buildReportFromScanContext(ctx);

    const hyg01 = report.checks.find((c) => c.id === 'HYG-01');
    expect(hyg01).toBeDefined();
    expect(hyg01!.docsUrl).toBe('https://github.com/aicraft-sdk/harness-audit#hyg-01');
  });

  it('applies the DOCS_BASE_URL + lowercased-id anchor format to every check in a real report', () => {
    const root = path.join(FIXTURES_ROOT, 'level-0');
    const ctx = createScanContext(root);
    const report = buildReportFromScanContext(ctx);

    expect(report.checks.length).toBeGreaterThan(0);
    for (const check of report.checks) {
      expect(check.docsUrl).toBe(`${DOCS_BASE_URL}#${check.id.toLowerCase()}`);
    }
  });
});
