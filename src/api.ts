/**
 * Programmatic API — a pure async function callers can import and call
 * directly. No CLI/`process.argv`/`console.log` concerns here; a future CLI
 * (Phase 4) wraps this.
 *
 * `runAudit` resolves config (explicit `config` param, or `.harness-audit.json`
 * loaded from `root`, or defaults = core pack only, matching Phase 1's exact
 * behavior when no config exists), composes the pack registry, scans `root`,
 * and produces a `Report`.
 */

import { buildOverlays } from './harness/global-paths.js';
import { loadHarnessAuditConfigFile, resolveScanConfig, type HarnessAuditConfig } from './config.js';
import { corePack } from './packs/core/index.js';
import { composeRegistry, type CheckOverride } from './registry.js';
import { createScanContext } from './scan.js';
import { buildReportFromContext } from './score.js';
import type { CheckPack, Report } from './types.js';

export interface RunAuditOptions {
  root: string;
  config?: HarnessAuditConfig;
}

const BUILTIN_PACKS: Record<string, CheckPack> = { core: corePack };

async function resolvePackEntry(key: string, value: boolean | string | CheckPack): Promise<CheckPack | null> {
  if (value === false) return null;

  if (value === true) {
    const builtin = BUILTIN_PACKS[key];
    if (!builtin) {
      throw new Error(
        `runAudit: pack "${key}" is enabled with "true" but is not a built-in pack (only "core" is built in) — pass a module path or a CheckPack object instead.`,
      );
    }
    return builtin;
  }

  if (typeof value === 'string') {
    const imported = (await import(value)) as { default?: CheckPack; pack?: CheckPack };
    const pack = imported.default ?? imported.pack;
    if (!pack || typeof pack.id !== 'string' || !Array.isArray(pack.checks)) {
      throw new Error(
        `runAudit: module "${value}" for pack "${key}" does not export a valid CheckPack (expected a default export or a named "pack" export).`,
      );
    }
    return pack;
  }

  return value;
}

async function resolvePacks(config: HarnessAuditConfig): Promise<CheckPack[]> {
  const packsConfig = config.packs ?? { core: true };
  const packs: CheckPack[] = [];
  for (const [key, value] of Object.entries(packsConfig)) {
    const pack = await resolvePackEntry(key, value);
    if (pack) packs.push(pack);
  }
  return packs;
}

/** Build a full `Report` for `root`, resolving config from the explicit param, `.harness-audit.json`, or defaults. */
export async function runAudit(options: RunAuditOptions): Promise<Report> {
  const { root } = options;
  const config = options.config ?? loadHarnessAuditConfigFile(root) ?? {};

  const packs = await resolvePacks(config);
  const checkOverrides: Record<string, CheckOverride> = {};
  for (const [id, entry] of Object.entries(config.checks ?? {})) {
    checkOverrides[id] = entry;
  }
  const registry = composeRegistry({
    packs,
    checkOverrides,
    extraDimensions: config.dimensions ?? [],
  });

  const scanConfig = resolveScanConfig(config);
  const maturityCtx = createScanContext(root);
  const hasExtraScopes =
    scanConfig.scopes.user || scanConfig.scopes.system || scanConfig.extraRoots.length > 0;

  if (!hasExtraScopes) {
    return buildReportFromContext(maturityCtx, maturityCtx, scanConfig, undefined, registry, config.levels);
  }

  const { overlays, resolvedRoots } = buildOverlays(root, scanConfig.scopes, scanConfig.extraRoots);
  const effectiveCtx = createScanContext(root, { overlays });
  return buildReportFromContext(maturityCtx, effectiveCtx, scanConfig, resolvedRoots, registry, config.levels);
}
