import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAudit } from './api.js';
import { DEFAULT_LEVEL_REQUIREMENTS, buildReportFromScanContext } from './score.js';
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

describe('runAudit — external pack loaded from a string module path', () => {
  const EXTERNAL_PACKS_ROOT = path.resolve(__dirname, '../test/fixtures/external-packs');

  it('dynamically imports the module, validates it, and composes its checks into the report', async () => {
    const root = path.join(FIXTURES_ROOT, 'level-4');
    const modulePath = path.join(EXTERNAL_PACKS_ROOT, 'valid-pack.ts');

    const report = await runAudit({
      root,
      config: { packs: { core: false, 'my-external': modulePath } },
    });

    const check1 = report.checks.find((c) => c.id === 'FIX-EXT-01');
    const check2 = report.checks.find((c) => c.id === 'FIX-EXT-02');
    expect(report.checks).toHaveLength(2);
    expect(check1).toMatchObject({ id: 'FIX-EXT-01', passed: true, earned: 5, points: 5 });
    expect(check2).toMatchObject({ id: 'FIX-EXT-02', passed: false, earned: 0, points: 7 });
  });

  it('throws a clear error when the module does not export a valid CheckPack', async () => {
    const root = path.join(FIXTURES_ROOT, 'level-4');
    const modulePath = path.join(EXTERNAL_PACKS_ROOT, 'invalid-pack.ts');

    await expect(
      runAudit({ root, config: { packs: { core: false, 'my-external': modulePath } } }),
    ).rejects.toThrow(/does not export a valid CheckPack/);
  });
});

describe('runAudit — "levels" config override', () => {
  it('with no "levels" config, every fixture lands on its default-ladder level (byte-identical to today)', async () => {
    for (const { dir, expectedLevel } of LEVEL_FIXTURES) {
      const root = path.join(FIXTURES_ROOT, dir);
      const report = await runAudit({ root });
      expect(report.level.index).toBe(expectedLevel);
    }
  });

  it('lowering L3\'s sensors/ci thresholds moves level-2 from L2 to L3 (a specific, different, deterministic level)', async () => {
    const root = path.join(FIXTURES_ROOT, 'level-2');

    const baseline = await runAudit({ root });
    expect(baseline.level.index).toBe(2);

    const lowered = [
      DEFAULT_LEVEL_REQUIREMENTS[0]!,
      DEFAULT_LEVEL_REQUIREMENTS[1]!,
      [{ dimension: 'sensors', minPercent: 0 }, { dimension: 'ci', minPercent: 0 }],
      DEFAULT_LEVEL_REQUIREMENTS[3]!,
    ];
    const overridden = await runAudit({ root, config: { levels: lowered } });

    expect(overridden.level.index).toBe(3);
    expect(overridden.level.index).not.toBe(baseline.level.index);
  });

  it('an "anyOf" + "totalMinPercent" override at L4 moves level-3 from L3 to L4', async () => {
    const root = path.join(FIXTURES_ROOT, 'level-3');

    const baseline = await runAudit({ root });
    expect(baseline.level.index).toBe(3);

    // level-3 fixture: hooks=0% (fails default L4's hooks>=70), ci=79%, total=81%.
    // Replace L4's plain "hooks>=70" with an anyOf allowing ci>=70 instead,
    // and keep totalMinPercent (already met) — both non-plain-dimension shapes.
    const raisedAnyOfAndTotal = [
      DEFAULT_LEVEL_REQUIREMENTS[0]!,
      DEFAULT_LEVEL_REQUIREMENTS[1]!,
      DEFAULT_LEVEL_REQUIREMENTS[2]!,
      [
        { anyOf: [{ dimension: 'hooks', minPercent: 70 }, { dimension: 'ci', minPercent: 70 }] },
        { totalMinPercent: 80 },
      ],
    ];
    const overridden = await runAudit({ root, config: { levels: raisedAnyOfAndTotal } });

    expect(overridden.level.index).toBe(4);
    expect(overridden.level.index).not.toBe(baseline.level.index);
  });

  it('rejects a malformed "levels" config loaded from .harness-audit.json (not exactly 4 entries)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-levels-'));
    try {
      fs.writeFileSync(
        path.join(dir, '.harness-audit.json'),
        JSON.stringify({ levels: [[{ dimension: 'context', minPercent: 40 }]] }),
      );
      await expect(runAudit({ root: dir })).rejects.toThrow(/"levels" must have exactly 4 entries/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
