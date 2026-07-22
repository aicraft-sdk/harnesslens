import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runAudit } from './api.js';
import { aiCraftPack } from './packs/ai-craft/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../test/fixtures');

describe('ai-craft pack composed through the real runAudit/composeRegistry path', () => {
  it('includes ai-craft checks in report.checks and the company dimension in report.dimensions', async () => {
    const root = path.join(FIXTURES_ROOT, 'ai-craft-plugin');

    const report = await runAudit({
      root,
      config: { packs: { core: true, 'ai-craft': aiCraftPack } },
    });

    const aic01 = report.checks.find((c) => c.id === 'AIC-01');
    expect(aic01).toMatchObject({ id: 'AIC-01', dimension: 'company', passed: true });

    const companyDim = report.dimensions.find((d) => d.id === 'company');
    expect(companyDim).toMatchObject({ id: 'company', title: 'AI-Craft Conventions' });
    expect(companyDim?.max).toBeGreaterThan(0);
    expect(companyDim?.earned).toBeGreaterThan(0);

    // Core checks still run unaffected — composition is additive, not a replacement.
    expect(report.checks.some((c) => c.id === 'CTX-01')).toBe(true);
  });

  it('scores the same fixture as zero on the plugin-detection checks when the ai-craft pack is absent', async () => {
    const root = path.join(FIXTURES_ROOT, 'ai-craft-plugin');

    const withoutAiCraft = await runAudit({ root });

    expect(withoutAiCraft.checks.some((c) => c.id === 'AIC-01')).toBe(false);
    expect(withoutAiCraft.dimensions.some((d) => d.id === 'company')).toBe(false);
  });

  it('credits the false-negative fixture (plugin harness) while a plain fixture without one still scores zero on plugin-detection checks', async () => {
    const pluginRoot = path.join(FIXTURES_ROOT, 'ai-craft-plugin');
    const level0Root = path.join(FIXTURES_ROOT, 'level-0');
    const config = { packs: { core: true, 'ai-craft': aiCraftPack } };
    const pluginDetectionIds = ['AIC-01', 'AIC-02', 'AIC-03'];

    const pluginReport = await runAudit({ root: pluginRoot, config });
    const level0Report = await runAudit({ root: level0Root, config });

    const pluginEarned = pluginReport.checks
      .filter((c) => pluginDetectionIds.includes(c.id))
      .reduce((sum, c) => sum + c.earned, 0);
    const level0Earned = level0Report.checks
      .filter((c) => pluginDetectionIds.includes(c.id))
      .reduce((sum, c) => sum + c.earned, 0);

    expect(pluginEarned).toBeGreaterThan(0);
    expect(level0Earned).toBe(0);
  });
});
