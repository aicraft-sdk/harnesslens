/**
 * Ported verbatim from harness-score's `harness/mcp.ts`
 * (https://github.com/paladini/harness-score, MIT — see NOTICE).
 */

import type { ScanContext } from '../types.js';
import { collectMcpConfigs } from './collectors.js';

export function mcpConfigPaths(ctx: ScanContext): string[] {
  return collectMcpConfigs(ctx).map((a) => a.path);
}
