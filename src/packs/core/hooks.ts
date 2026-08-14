/**
 * Hooks dimension checks (`checks/hooks.ts`). See NOTICE for third-party
 * attribution.
 */

import { hookCommandPathsResolve, readNormalizedHooks } from '../../harness/hooks.js';
import type { Check, ScanContext } from '../../types.js';
import { safeJsonParse } from '../../util.js';

/** Claude Code settings files that may carry a `permissions` allow/deny/ask scope. */
const CLAUDE_SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];

interface ClaudePermissionsSettings {
  permissions?: { allow?: unknown; deny?: unknown; ask?: unknown };
}

function nonEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

interface ToolPermissionScopeResult {
  hasScope: boolean;
  /** File that existed but failed to parse as JSON, if any (distinct from "scope empty"). */
  invalidJsonFile: string | null;
  /** True if some other file parsed validly but its permissions block was present-and-empty
   * (as opposed to absent) — distinguishes "nothing else even tried" from "another file tried
   * and also failed to grant scope", so evidence can mention both failures. */
  otherFileParsedButEmpty: boolean;
}

/** Reports whether a Claude Code settings file declares a non-empty allow/deny/ask scope,
 * distinguishing a malformed-JSON settings file from a validly-parsed-but-empty one. A
 * later file's valid non-empty scope still passes even if an earlier file failed to parse;
 * the parse failure is only surfaced when no file ends up granting scope. */
function hasToolPermissionScope(ctx: ScanContext): ToolPermissionScopeResult {
  let invalidJsonFile: string | null = null;
  let otherFileParsedButEmpty = false;
  for (const file of CLAUDE_SETTINGS_FILES) {
    if (!ctx.has(file)) continue;
    const parsed = safeJsonParse(ctx.read(file) ?? '');
    if (parsed === undefined) {
      invalidJsonFile ??= file;
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const permissions = (parsed as ClaudePermissionsSettings).permissions;
    if (!permissions || typeof permissions !== 'object') continue;
    if (nonEmptyList(permissions.allow) || nonEmptyList(permissions.deny) || nonEmptyList(permissions.ask)) {
      return { hasScope: true, invalidJsonFile: null, otherFileParsedButEmpty: false };
    }
    otherFileParsedButEmpty = true;
  }
  return { hasScope: false, invalidJsonFile, otherFileParsedButEmpty };
}

export const hookChecks: Check[] = [
  {
    id: 'HKS-01',
    dimension: 'hooks',
    title: 'Hooks configuration present and valid JSON',
    points: 4,
    remediation:
      'Create a hooks configuration (.cursor/hooks.json or .claude/settings.json hooks key) — hooks are the harness layer that can observe and control the agent loop deterministically.',
    run(ctx) {
      const hooks = readNormalizedHooks(ctx);
      if (!hooks) {
        return {
          passed: false,
          evidence: 'No .cursor/hooks.json or .claude/settings.json hooks configuration found.',
        };
      }
      return { passed: true, evidence: `${hooks.source} parses as JSON.` };
    },
  },
  {
    id: 'HKS-02',
    dimension: 'hooks',
    title: 'Hooks use known events and a version field',
    points: 2,
    remediation:
      'Register handlers only on documented events for your tool (Cursor: beforeShellExecution, afterFileEdit, …; Claude Code: PreToolUse, PostToolUse, …) — typos fail silently.',
    run(ctx) {
      const hooks = readNormalizedHooks(ctx);
      if (!hooks) {
        return { passed: false, evidence: 'No parseable hooks configuration.' };
      }
      const passed = hooks.hasVersion && hooks.events.length > 0 && hooks.unknownEvents.length === 0;
      return {
        passed,
        evidence:
          hooks.events.length === 0
            ? `${hooks.source} has no registered events.`
            : hooks.unknownEvents.length > 0
              ? `Unknown event name(s): ${hooks.unknownEvents.join(', ')}`
              : `${hooks.source}: events: ${hooks.events.join(', ')}.`,
      };
    },
  },
  {
    id: 'HKS-03',
    dimension: 'hooks',
    title: 'Gate hook guards risky operations',
    points: 4,
    remediation:
      'Register a gate hook (Cursor: beforeShellExecution / beforeMCPExecution / preToolUse; Claude Code: PreToolUse) that returns allow/deny/ask for destructive operations.',
    run(ctx) {
      const hooks = readNormalizedHooks(ctx);
      if (!hooks) {
        return { passed: false, evidence: 'No parseable hooks configuration.' };
      }
      return hooks.gateEvents.length > 0
        ? { passed: true, evidence: `Gate hook(s) registered on: ${hooks.gateEvents.join(', ')}.` }
        : {
            passed: false,
            evidence: `No gate hooks registered in ${hooks.source}.`,
          };
    },
  },
  {
    id: 'HKS-04',
    dimension: 'hooks',
    title: 'Feedback hook observes agent output',
    points: 2,
    remediation:
      'Register a feedback hook (Cursor: afterFileEdit / postToolUse / stop; Claude Code: PostToolUse) — e.g. auto-format edited files or run a quick lint.',
    run(ctx) {
      const hooks = readNormalizedHooks(ctx);
      if (!hooks) {
        return { passed: false, evidence: 'No parseable hooks configuration.' };
      }
      return hooks.feedbackEvents.length > 0
        ? {
            passed: true,
            evidence: `Feedback hook(s) registered on: ${hooks.feedbackEvents.join(', ')}.`,
          }
        : {
            passed: false,
            evidence: `No feedback hooks registered in ${hooks.source}.`,
          };
    },
  },
  {
    id: 'HKS-05',
    dimension: 'hooks',
    title: 'Hook scripts exist in the repository',
    points: 2,
    remediation:
      'Commit the scripts referenced by your hooks config — a hook pointing at a missing script fails open on every machine but yours.',
    run(ctx) {
      const hooks = readNormalizedHooks(ctx);
      if (!hooks) {
        return { passed: false, evidence: 'No parseable hooks configuration.' };
      }
      if (hooks.commands.length === 0) {
        return { passed: false, evidence: 'No hook commands declared.' };
      }
      const { validated, missing } = hookCommandPathsResolve(hooks.commands, (p) => ctx.has(p));
      if (validated === 0) {
        return {
          passed: true,
          evidence: 'Hook commands do not reference in-repo paths (nothing to resolve).',
        };
      }
      return missing.length === 0
        ? {
            passed: true,
            evidence: `All ${validated} path-referencing hook command(s) resolve to committed files.`,
          }
        : { passed: false, evidence: `Hook command(s) reference missing files: ${missing.join(' | ')}` };
    },
  },
  {
    id: 'HKS-06',
    dimension: 'hooks',
    title: 'Explicit tool-permission scope declared',
    points: 3,
    remediation:
      'Declare a non-empty allow/deny/ask tool-permission scope (.claude/settings.json permissions block) — an unrestricted agent can run any tool with no gate.',
    run(ctx) {
      if (!CLAUDE_SETTINGS_FILES.some((f) => ctx.has(f))) {
        return {
          passed: false,
          evidence: 'No .claude/settings.json or settings.local.json found (no tool-permission scope declared).',
        };
      }
      const result = hasToolPermissionScope(ctx);
      if (result.hasScope) {
        return { passed: true, evidence: 'Claude Code settings declare a non-empty permissions allow/deny/ask list.' };
      }
      if (result.invalidJsonFile) {
        return {
          passed: false,
          evidence: result.otherFileParsedButEmpty
            ? `${result.invalidJsonFile} is not valid JSON, and no other settings file declares a non-empty permissions scope.`
            : `${result.invalidJsonFile} is not valid JSON.`,
        };
      }
      return {
        passed: false,
        evidence: 'Claude Code settings found but permissions allow/deny/ask lists are empty or absent.',
      };
    },
  },
];
