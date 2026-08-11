import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composeRegistry } from './registry.js';
import { corePack } from './packs/core/index.js';
import { aiCraftPack } from './packs/ai-craft/index.js';
import { getFrameworkMapping } from './framework-mappings.js';
import { buildReportFromScanContext, createScanContext } from './index.js';
import { renderTerminal } from './report/terminal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEVEL_2_FIXTURE = path.resolve(__dirname, '../test/fixtures/level-2');

describe('framework-mappings completeness', () => {
  it('has a non-empty NIST+OWASP mapping for every dimension the default CLI composition scores', () => {
    const { dimensions } = composeRegistry({ packs: [corePack, aiCraftPack] });
    for (const dim of dimensions) {
      const mapping = getFrameworkMapping(dim.id);
      expect(mapping, `missing framework mapping for dimension "${dim.id}"`).toBeDefined();
      expect(mapping!.nistFunctions.length).toBeGreaterThan(0);
      // OWASP ids may be empty only for a dimension explicitly TODO-flagged in Task 1.1.
    }
  });
});

describe('framework-mappings — custom extraDimensions outside the built-in 8', () => {
  it('appears in report.dimensions, has no CheckResult or frameworkMapping entry, and renders in the terminal without crashing', () => {
    const registry = composeRegistry({
      packs: [corePack],
      extraDimensions: [{ id: 'custom-extra', title: 'Custom Extra Dimension' }],
    });
    const report = buildReportFromScanContext(createScanContext(LEVEL_2_FIXTURE), registry);

    // Dimension shows up in the scored dimension list (0/0, no checks target it).
    expect(report.dimensions).toContainEqual({
      id: 'custom-extra',
      title: 'Custom Extra Dimension',
      earned: 0,
      max: 0,
      percent: 0,
    });
    // No check results are fabricated for a dimension with no checks.
    expect(report.checks.some((c) => c.dimension === 'custom-extra')).toBe(false);
    // Safely absent (not throwing) from frameworkMapping — a custom dimension
    // has no entry in the built-in NIST/OWASP crosswalk.
    expect(report.frameworkMapping['custom-extra']).toBeUndefined();

    expect(() => renderTerminal(report)).not.toThrow();
    const output = renderTerminal(report);
    expect(output).toContain('Custom Extra Dimension');
  });
});
