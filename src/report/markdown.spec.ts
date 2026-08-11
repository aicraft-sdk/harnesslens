import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReportFromScanContext, createScanContext } from '../index.js';
import { renderMarkdown } from './markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEVEL_2_FIXTURE = path.resolve(__dirname, '../../test/fixtures/level-2');

describe('renderMarkdown — framework mapping column', () => {
  it('adds a Framework mapping column with content for the context row', () => {
    const output = renderMarkdown(buildReportFromScanContext(createScanContext(LEVEL_2_FIXTURE)));
    expect(output).toContain('| Dimension | Score | % | Framework mapping |');
    expect(output).toMatch(/Context & Guides.*NIST: Govern/);
  });
});
