/**
 * `.harness-audit.json` config file: parse + strict validation, plus
 * resolution into the `ResolvedScanConfig` the scanner needs. Extends Phase
 * 1's `scan-config.ts` stub (which only carried `scopes`/`extraRoots`/`gate`)
 * with `packs`/`checks`/`dimensions`/`levels` — the pieces `registry.ts` and
 * `api.ts` need to compose a customized report without forking this package.
 *
 * Validation mirrors the strictness of the rest of this package's ported
 * types (no `any`, reject unknown top-level keys, one clear error message
 * per problem) since `scan-config.ts` itself is Phase 1 type-only and has no
 * prior runtime-validation code to follow verbatim.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckPack, DimensionInfo } from './types.js';
import { DEFAULT_SCAN_CONFIG, type ExtraRootEntry, type GateMode, type ResolvedScanConfig } from './scan-config.js';

export const CONFIG_FILE_NAME = '.harness-audit.json';

export interface CheckOverrideEntry {
  enabled?: boolean;
  points?: number;
}

export interface HarnessAuditConfig {
  /** Pack id → enabled (`true`/`false`), a module path/name to import, or (programmatic callers only) a live `CheckPack`. */
  packs?: Record<string, boolean | string | CheckPack>;
  checks?: Record<string, CheckOverrideEntry>;
  dimensions?: DimensionInfo[];
  /** Reserved for a future maturity-ladder override mechanism; accepted but not yet interpreted. */
  levels?: unknown[];
  extraRoots?: ExtraRootEntry[];
  scopes?: { user?: boolean; system?: boolean };
  gate?: GateMode;
}

const KNOWN_TOP_LEVEL_KEYS = new Set(['packs', 'checks', 'dimensions', 'levels', 'extraRoots', 'scopes', 'gate']);
const KNOWN_GATE_MODES = new Set(['maturity', 'effective']);

function fail(message: string): never {
  throw new Error(`${CONFIG_FILE_NAME}: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePacks(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) fail('"packs" must be an object mapping pack id to true/false/module path.');
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'boolean' || typeof entry === 'string') continue;
    // Programmatic callers may pass a live CheckPack object directly (not
    // JSON-serializable); accept anything already shaped like one.
    if (isPlainObject(entry) && typeof entry.id === 'string' && Array.isArray(entry.checks)) continue;
    fail(`"packs.${key}" must be true, false, a module path string, or a CheckPack object.`);
  }
}

function validateChecks(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) fail('"checks" must be an object mapping check id to an override.');
  for (const [key, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) fail(`"checks.${key}" must be an object with optional "enabled"/"points".`);
    if ('enabled' in entry && typeof entry.enabled !== 'boolean') {
      fail(`"checks.${key}.enabled" must be a boolean.`);
    }
    if ('points' in entry && typeof entry.points !== 'number') {
      fail(`"checks.${key}.points" must be a number.`);
    }
  }
}

function validateDimensions(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail('"dimensions" must be an array of { id, title }.');
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string') {
      fail('each "dimensions" entry must be an object with string "id" and "title".');
    }
  }
}

function validateExtraRoots(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail('"extraRoots" must be an array of { id, path }.');
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || typeof entry.path !== 'string') {
      fail('each "extraRoots" entry must be an object with string "id" and "path".');
    }
  }
}

function validateScopes(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) fail('"scopes" must be an object with optional "user"/"system" booleans.');
  if ('user' in value && typeof value.user !== 'boolean') fail('"scopes.user" must be a boolean.');
  if ('system' in value && typeof value.system !== 'boolean') fail('"scopes.system" must be a boolean.');
}

function validateGate(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !KNOWN_GATE_MODES.has(value)) {
    fail('"gate" must be "maturity" or "effective".');
  }
}

function validateLevels(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail('"levels" must be an array.');
}

/** Validate a parsed `.harness-audit.json` object; throws with a clear message on the first problem found. */
export function validateHarnessAuditConfig(raw: unknown): HarnessAuditConfig {
  if (!isPlainObject(raw)) fail('root value must be a JSON object.');
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) fail(`unknown top-level key "${key}".`);
  }
  validatePacks(raw.packs);
  validateChecks(raw.checks);
  validateDimensions(raw.dimensions);
  validateExtraRoots(raw.extraRoots);
  validateScopes(raw.scopes);
  validateGate(raw.gate);
  validateLevels(raw.levels);
  return raw as HarnessAuditConfig;
}

/** Load and validate `.harness-audit.json` from `root`; returns null when the file is absent. */
export function loadHarnessAuditConfigFile(root: string): HarnessAuditConfig | null {
  const filePath = path.join(root, CONFIG_FILE_NAME);
  if (!fs.existsSync(filePath)) return null;

  const text = fs.readFileSync(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON — ${String(error)}`);
  }
  return validateHarnessAuditConfig(parsed);
}

/** Resolve a `HarnessAuditConfig` into the `ResolvedScanConfig` the scanner needs. */
export function resolveScanConfig(config: HarnessAuditConfig): ResolvedScanConfig {
  const scopes = {
    user: config.scopes?.user ?? DEFAULT_SCAN_CONFIG.scopes.user,
    system: config.scopes?.system ?? DEFAULT_SCAN_CONFIG.scopes.system,
  };
  const extraRoots = config.extraRoots ?? DEFAULT_SCAN_CONFIG.extraRoots;
  const gate = config.gate ?? DEFAULT_SCAN_CONFIG.gate;
  const effectiveScopes: ResolvedScanConfig['effectiveScopes'] = [
    'repo',
    ...(scopes.user ? (['user'] as const) : []),
    ...(scopes.system ? (['system'] as const) : []),
    ...extraRoots.map((entry) => entry.id),
  ];
  return { scopes, extraRoots, gate, effectiveScopes };
}
