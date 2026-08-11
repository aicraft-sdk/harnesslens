import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReportFromScanContext, createScanContext } from '../index.js';
import { renderTerminal } from './terminal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEVEL_2_FIXTURE = path.resolve(__dirname, '../../test/fixtures/level-2');

describe('renderTerminal — framework mapping annotation', () => {
  it('shows the NIST/OWASP mapping for the context dimension row', () => {
    const report = buildReportFromScanContext(createScanContext(LEVEL_2_FIXTURE));
    const output = renderTerminal(report);
    expect(output).toContain('NIST:');
    expect(output).toContain('Govern');
  });
});
