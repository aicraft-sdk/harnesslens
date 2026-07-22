/**
 * Minimal scan-configuration types, ported from harness-score's `config.ts`
 * (https://github.com/paladini/harness-score, MIT — see NOTICE).
 *
 * Phase 1 only needs the *shape* of a resolved scan configuration so the
 * ported `score.ts`/`types.ts`/`harness/global-paths.ts` compile against the
 * same contract upstream uses. The `.harness-audit.json` file-driven config
 * loader (parse/validate/discover) is Phase 2 scope and intentionally not
 * ported here — `DEFAULT_SCAN_CONFIG` is the only config `buildReport` needs
 * for a single-repo, maturity-gated scan.
 */

export type GateMode = 'maturity' | 'effective';
export type ScopeFlag = 'user' | 'system';

export interface ExtraRootEntry {
  id: string;
  path: string;
}

export interface ResolvedScanConfig {
  scopes: {
    user: boolean;
    system: boolean;
  };
  extraRoots: ExtraRootEntry[];
  gate: GateMode;
  /** Scopes included in the effective score (repo is always first). */
  effectiveScopes: Array<'repo' | 'user' | 'system' | string>;
}

export const DEFAULT_SCAN_CONFIG: ResolvedScanConfig = {
  scopes: { user: false, system: false },
  extraRoots: [],
  gate: 'maturity',
  effectiveScopes: ['repo'],
};
