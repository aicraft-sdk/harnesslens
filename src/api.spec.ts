import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAudit } from './api.js';
import { buildReportFromScanContext } from './score.js';
import { createScanContext } from './scan.js';
import type { Check, CheckPack } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../test/fixtures');

const LEVEL_FIXTURES = [
  { dir: 'level-0', expectedLevel: 0 },
  { dir: 'level-1', expectedLevel: 1 },
  { dir: 'level-2', expectedLevel: 2 },
  { dir: 'level-3', expectedLevel: 3 },
  { dir: 'level-4', expectedLevel: 4 },
];

describe('runAudit — no-config regression parity', () => {
  for (const { dir, expectedLevel } of LEVEL_FIXTURES) {
    it(`matches the direct scan+score pipeline for ${dir} (still level ${expectedLevel})`, async () => {
      const root = path.join(FIXTURES_ROOT, dir);

      const viaApi = await runAudit({ root });
      const direct = buildReportFromScanContext(createScanContext(root));

      expect(viaApi.level.index).toBe(expectedLevel);
      expect(viaApi.level).toEqual(direct.level);
      expect(viaApi.score).toEqual(direct.score);
      expect(viaApi.dimensions).toEqual(direct.dimensions);
      expect(viaApi.checks).toEqual(direct.checks);
    });
  }
});

describe('runAudit — disable check + reweight dimension', () => {
  it('produces a deterministic, different score than the unconfigured run', async () => {
    const root = path.join(FIXTURES_ROOT, 'level-4');

    const baseline = await runAudit({ root });
    const hygCheck = baseline.checks.find((c) => c.id === 'HYG-05');
    if (!hygCheck) throw new Error('fixture assumption broken: HYG-05 not found in baseline checks');

    const configured = await runAudit({
      root,
      config: {
        checks: {
          'HYG-05': { enabled: false },
          'HYG-01': { points: 20 },
        },
      },
    });

    const hygDim = baseline.dimensions.find((d) => d.id === 'hygiene');
    if (!hygDim) throw new Error('fixture assumption broken: hygiene dimension not found');
    const configuredHygDim = configured.dimensions.find((d) => d.id === 'hygiene');

    // HYG-05 (2 pts) removed entirely; HYG-01 (2 pts) reweighted to 20 pts:
    // max goes from `hygDim.max` to `hygDim.max - 2 (HYG-05 removed) + 18 (HYG-01 +18)`.
    expect(configuredHygDim?.max).toBe(hygDim.max - hygCheck.points + 18);
    expect(configured.checks.some((c) => c.id === 'HYG-05')).toBe(false);
    expect(configured.score.max).toBe(baseline.score.max - hygCheck.points + 18);
    expect(configured.score).not.toEqual(baseline.score);
  });
});

describe('runAudit — external pack composition', () => {
  it('composes an external pack alongside core and includes its checks in the report', async () => {
    const root = path.join(FIXTURES_ROOT, 'level-4');

    const passingCheck: Check = {
      id: 'EXT-01',
      dimension: 'context',
      title: 'Fixture external check (always passes)',
      points: 4,
      remediation: 'n/a',
      run: () => ({ passed: true, evidence: 'fixture always passes' }),
    };
    const failingCheck: Check = {
      id: 'EXT-02',
      dimension: 'context',
      title: 'Fixture external check (always fails)',
      points: 6,
      remediation: 'n/a',
      run: () => ({ passed: false, evidence: 'fixture always fails' }),
    };
    const externalPack: CheckPack = { id: 'external-fixture', checks: [passingCheck, failingCheck] };

    const report = await runAudit({
      root,
      config: { packs: { core: true, 'external-fixture': externalPack } },
    });

    const ext01 = report.checks.find((c) => c.id === 'EXT-01');
    const ext02 = report.checks.find((c) => c.id === 'EXT-02');
    expect(ext01).toMatchObject({ id: 'EXT-01', passed: true, earned: 4, points: 4 });
    expect(ext02).toMatchObject({ id: 'EXT-02', passed: false, earned: 0, points: 6 });
  });
});

describe('runAudit — .harness-audit.json file resolution', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-runaudit-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads .harness-audit.json from root when no explicit config is passed', async () => {
    fs.writeFileSync(path.join(dir, '.harness-audit.json'), JSON.stringify({ checks: { 'HYG-05': { enabled: false } } }));

    const report = await runAudit({ root: dir });

    expect(report.checks.some((c) => c.id === 'HYG-05')).toBe(false);
  });
});
