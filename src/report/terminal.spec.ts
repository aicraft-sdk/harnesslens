import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReportFromScanContext, createScanContext } from '../index.js';
import type { Report } from '../types.js';
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

  it('omits the " · OWASP:" suffix when a mapping has an empty owaspIds array (test-only override)', () => {
    // Every real FRAMEWORK_MAPPINGS entry currently has a non-empty owaspIds
    // array, so this branch (terminal.ts's `mapping.owaspIds.length > 0 ? ... : ''`
    // ternary) is exercised here via a test-only frameworkMapping override —
    // never by editing the real, sourced FRAMEWORK_MAPPINGS crosswalk data.
    const report = buildReportFromScanContext(createScanContext(LEVEL_2_FIXTURE));
    const overridden: Report = {
      ...report,
      frameworkMapping: { context: { nistFunctions: ['Govern'], owaspIds: [] } },
    };

    const output = renderTerminal(overridden);

    expect(output).toContain('↳ NIST: Govern');
    expect(output).not.toContain('OWASP:');
  });
});
