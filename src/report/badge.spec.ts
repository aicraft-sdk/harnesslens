import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReportFromScanContext, createScanContext } from '../index.js';
import { renderBadge } from './badge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEVEL_2_FIXTURE = path.resolve(__dirname, '../../test/fixtures/level-2');

describe('renderBadge — framework mapping tooltip', () => {
  it('mentions NIST/OWASP in the title without changing the visible label/value text', () => {
    const report = buildReportFromScanContext(createScanContext(LEVEL_2_FIXTURE));
    const svg = renderBadge(report);
    expect(svg).toContain('NIST AI RMF');
    expect(svg).toContain('OWASP Agentic AI Top 10');
    expect(svg).toContain('>harness</text>');
    expect(svg).toContain(`>L${report.level.index}</text>`);
  });

  it('uses the HarnessLens-branded tooltip', () => {
    const report = buildReportFromScanContext(createScanContext(LEVEL_2_FIXTURE));
    const svg = renderBadge(report);
    expect(svg).toContain('HarnessLens Score:');
  });
});
