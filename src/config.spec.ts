import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE_NAME, loadHarnessAuditConfigFile, resolveScanConfig, validateHarnessAuditConfig } from './config.js';

describe('validateHarnessAuditConfig', () => {
  it('accepts an empty object', () => {
    expect(validateHarnessAuditConfig({})).toEqual({});
  });

  it('rejects a non-object root value', () => {
    expect(() => validateHarnessAuditConfig('nope')).toThrow(/root value must be a JSON object/);
  });

  it('rejects an unknown top-level key with a clear message', () => {
    expect(() => validateHarnessAuditConfig({ bogus: true })).toThrow(/unknown top-level key "bogus"/);
  });

  it('rejects a non-boolean "checks.<id>.enabled"', () => {
    expect(() => validateHarnessAuditConfig({ checks: { 'CTX-01': { enabled: 'yes' } } })).toThrow(
      /"checks.CTX-01.enabled" must be a boolean/,
    );
  });

  it('rejects a non-number "checks.<id>.points"', () => {
    expect(() => validateHarnessAuditConfig({ checks: { 'CTX-01': { points: '5' } } })).toThrow(
      /"checks.CTX-01.points" must be a number/,
    );
  });

  it('rejects an invalid "gate" value', () => {
    expect(() => validateHarnessAuditConfig({ gate: 'bogus' })).toThrow(/"gate" must be "maturity" or "effective"/);
  });

  it('accepts a fully populated valid config', () => {
    const raw = {
      packs: { core: true, extra: './extra-pack.js' },
      checks: { 'CTX-01': { enabled: false }, 'CTX-02': { points: 9 } },
      dimensions: [{ id: 'company', title: 'Company Standards' }],
      levels: [
        [{ dimension: 'context', minPercent: 40 }],
        [{ dimension: 'context', minPercent: 60 }, { anyOf: [{ dimension: 'skills', minPercent: 30 }] }],
        [{ dimension: 'sensors', minPercent: 60 }],
        [{ totalMinPercent: 80 }],
      ],
      extraRoots: [{ id: 'shared', path: '../shared' }],
      scopes: { user: true, system: false },
      gate: 'effective',
    };
    expect(validateHarnessAuditConfig(raw)).toEqual(raw);
  });
});

describe('validateHarnessAuditConfig — "levels" (maturity-ladder override)', () => {
  it('rejects a "levels" array that does not have exactly 4 entries', () => {
    expect(() => validateHarnessAuditConfig({ levels: [[{ dimension: 'context', minPercent: 40 }]] })).toThrow(
      /"levels" must have exactly 4 entries.*found 1/,
    );
  });

  it('rejects a "levels" entry that is not an array', () => {
    expect(() =>
      validateHarnessAuditConfig({
        levels: [{ dimension: 'context', minPercent: 40 }, [], [], []],
      }),
    ).toThrow(/"levels\[0\]" must be an array of requirement specs/);
  });

  it('rejects a spec object matching none of the 3 shapes', () => {
    expect(() =>
      validateHarnessAuditConfig({ levels: [[{ nonsense: true }], [], [], []] }),
    ).toThrow(/"levels\[0\]\[0\]" must match exactly one shape/);
  });

  it('rejects an "anyOf" entry with a non-array value', () => {
    expect(() =>
      validateHarnessAuditConfig({ levels: [[{ anyOf: 'nope' }], [], [], []] }),
    ).toThrow(/"levels\[0\]\[0\]"\.anyOf must be a non-empty array/);
  });

  it('rejects a "dimension" shape spec with a non-number "minPercent"', () => {
    expect(() =>
      validateHarnessAuditConfig({ levels: [[{ dimension: 'context', minPercent: '40' }], [], [], []] }),
    ).toThrow(/"levels\[0\]\[0\]" of shape \{ dimension, minPercent \}/);
  });

  it('rejects a "totalMinPercent" shape spec with a non-number value', () => {
    expect(() =>
      validateHarnessAuditConfig({ levels: [[{ totalMinPercent: 'lots' }], [], [], []] }),
    ).toThrow(/"levels\[0\]\[0\]"\.totalMinPercent must be a number/);
  });

  it('rejects a spec matching more than one shape at once', () => {
    expect(() =>
      validateHarnessAuditConfig({
        levels: [[{ dimension: 'context', minPercent: 40, totalMinPercent: 80 }], [], [], []],
      }),
    ).toThrow(/"levels\[0\]\[0\]" must match exactly one shape/);
  });

  it('accepts DEFAULT_LEVEL_REQUIREMENTS-shaped levels', () => {
    const levels = [
      [{ dimension: 'context', minPercent: 40 }],
      [
        { dimension: 'context', minPercent: 60 },
        { anyOf: [{ dimension: 'skills', minPercent: 30 }, { dimension: 'hooks', minPercent: 30 }] },
        { dimension: 'hygiene', minPercent: 50 },
      ],
      [{ dimension: 'sensors', minPercent: 60 }, { dimension: 'ci', minPercent: 50 }],
      [{ dimension: 'hooks', minPercent: 70 }, { totalMinPercent: 80 }],
    ];
    expect(validateHarnessAuditConfig({ levels })).toEqual({ levels });
  });
});

describe('loadHarnessAuditConfigFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-config-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when no config file is present', () => {
    expect(loadHarnessAuditConfigFile(dir)).toBeNull();
  });

  it('reads, parses, and validates the config file', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify({ gate: 'effective' }));
    expect(loadHarnessAuditConfigFile(dir)).toEqual({ gate: 'effective' });
  });

  it('throws a clear error on invalid JSON', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), '{not json');
    expect(() => loadHarnessAuditConfigFile(dir)).toThrow(/invalid JSON/);
  });
});

describe('resolveScanConfig', () => {
  it('falls back to DEFAULT_SCAN_CONFIG values when the config is empty', () => {
    expect(resolveScanConfig({})).toEqual({
      scopes: { user: false, system: false },
      extraRoots: [],
      gate: 'maturity',
      effectiveScopes: ['repo'],
    });
  });

  it('resolves scopes/extraRoots/gate overrides into effectiveScopes', () => {
    const resolved = resolveScanConfig({
      scopes: { user: true },
      extraRoots: [{ id: 'shared', path: '../shared' }],
      gate: 'effective',
    });
    expect(resolved).toEqual({
      scopes: { user: true, system: false },
      extraRoots: [{ id: 'shared', path: '../shared' }],
      gate: 'effective',
      effectiveScopes: ['repo', 'user', 'shared'],
    });
  });
});
