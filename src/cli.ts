#!/usr/bin/env node
/**
 * `harnesslens` CLI — Phase 4. Wraps `runAudit` (api.ts) plus the 3 report
 * renderers ported in Phase 1 with a manual-argv parser, following this
 * monorepo's established `main(argv, io)` convention (see
 * `packages/repo-conductor/src/cli/main.ts`). No commander dependency.
 *
 * Default check-pack composition here is the CLI's own opinionated default
 * (`core` + `ai-craft`) — `runAudit`'s own default (core-only) is unchanged
 * for programmatic callers. A `.harness-audit.json` in the target repo still
 * overrides via Phase 2's config system (loaded first; if present, it wins
 * outright, matching `runAudit`'s existing config-resolution contract).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from './api.js';
import { loadHarnessAuditConfigFile, type HarnessAuditConfig } from './config.js';
import { aiCraftPack } from './packs/ai-craft/index.js';
import { renderBadge } from './report/badge.js';
import { renderMarkdown } from './report/markdown.js';
import { renderTerminal } from './report/terminal.js';
import { loadRepoManifest, runMultiRepoAudit, type MultiRepoReport } from './multi-repo.js';

export interface CliIO {
  stdout: (s: string) => boolean;
  stderr: (s: string) => boolean;
}

export interface CliResult {
  exitCode: number;
}

const defaultIO: CliIO = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const HELP = `harnesslens — extensible AI-harness maturity scorer

Usage:
  harnesslens [path] [options]
  harnesslens multi --config <manifest.json> [options]

Options:
  --root <path>        Repo root to audit (default: positional arg, else cwd)
  --json                Print the full Report as JSON
  --md                  Print the report as Markdown
  --badge <path>        Write an SVG maturity badge to <path>
  --min-level <N>        Exit 1 if the maturity level index is below N
  --config <manifest>    (multi only) JSON manifest of { "repos": [{ "id", "path" }] }
  --help, -h            Show this help and exit
`;

interface ParsedArgs {
  subcommand: 'audit' | 'multi';
  root: string;
  json: boolean;
  md: boolean;
  badgePath?: string;
  minLevel?: number;
  manifestPath?: string;
  help: boolean;
}

type ParseResult = { args: ParsedArgs } | { error: string };

function parseArgs(argv: string[]): ParseResult {
  const rest = [...argv];
  let subcommand: ParsedArgs['subcommand'] = 'audit';
  if (rest[0] === 'multi') {
    subcommand = 'multi';
    rest.shift();
  }

  let root: string | undefined;
  let json = false;
  let md = false;
  let badgePath: string | undefined;
  let minLevel: number | undefined;
  let manifestPath: string | undefined;
  let help = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--json':
        json = true;
        break;
      case '--md':
        md = true;
        break;
      case '--root': {
        const value = rest[i + 1];
        if (!value) return { error: '--root requires a path argument' };
        root = value;
        i += 1;
        break;
      }
      case '--badge': {
        const value = rest[i + 1];
        if (!value) return { error: '--badge requires a file path argument' };
        badgePath = value;
        i += 1;
        break;
      }
      case '--min-level': {
        const value = rest[i + 1];
        const n = value === undefined ? NaN : Number(value);
        if (value === undefined || Number.isNaN(n)) return { error: '--min-level requires a numeric argument' };
        minLevel = n;
        i += 1;
        break;
      }
      case '--config': {
        const value = rest[i + 1];
        if (!value) return { error: '--config requires a file path argument' };
        manifestPath = value;
        i += 1;
        break;
      }
      default:
        if (arg === undefined) break;
        if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
        if (root !== undefined) return { error: `unexpected argument: ${arg}` };
        root = arg;
    }
  }

  return {
    args: {
      subcommand,
      root: root ?? process.cwd(),
      json,
      md,
      badgePath,
      minLevel,
      manifestPath,
      help,
    },
  };
}

async function runAuditCommand(args: ParsedArgs, io: CliIO): Promise<CliResult> {
  const root = path.resolve(args.root);

  let report: Awaited<ReturnType<typeof runAudit>>;
  try {
    const fileConfig = loadHarnessAuditConfigFile(root);
    const config: HarnessAuditConfig = fileConfig ?? { packs: { core: true, 'ai-craft': aiCraftPack } };
    report = await runAudit({ root, config });
  } catch (error) {
    io.stderr(`harnesslens: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }

  if (args.badgePath) {
    try {
      fs.writeFileSync(path.resolve(args.badgePath), renderBadge(report), 'utf8');
    } catch (error) {
      io.stderr(`harnesslens: failed to write badge — ${error instanceof Error ? error.message : String(error)}\n`);
      return { exitCode: 1 };
    }
  }

  if (args.json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else if (args.md) {
    io.stdout(renderMarkdown(report));
  } else {
    io.stdout(renderTerminal(report));
    io.stdout('\n');
  }

  if (args.minLevel !== undefined && report.level.index < args.minLevel) {
    return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

function renderMultiRepoTable(result: MultiRepoReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  harnesslens multi — ${result.results.length} repo(s)`);
  lines.push('');
  for (const { id, path: repoPath, report, error } of result.results) {
    if (report === null) {
      lines.push(`  ${id.padEnd(24)} FAILED: ${error}`.padEnd(56) + `  ${repoPath}`);
    } else {
      lines.push(`  ${id.padEnd(24)} L${report.level.index} · ${report.level.name}`.padEnd(56) + `  ${report.score.percent}%  ${repoPath}`);
    }
  }
  lines.push('');
  lines.push(
    `  Average: L${result.rollup.averageLevelIndex}   Score: ${result.rollup.averageScorePercent}%   (${result.rollup.repoCount} repos)`,
  );
  if (result.rollup.failedCount > 0) {
    lines.push(`  Failed: ${result.rollup.failedCount}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function runMultiCommand(args: ParsedArgs, io: CliIO): Promise<CliResult> {
  if (!args.manifestPath) {
    io.stderr('harnesslens multi: --config <manifest.json> is required\n');
    return { exitCode: 1 };
  }

  let result: MultiRepoReport;
  try {
    const entries = loadRepoManifest(args.manifestPath);
    result = await runMultiRepoAudit(entries);
  } catch (error) {
    io.stderr(`harnesslens multi: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }

  if (args.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout(renderMultiRepoTable(result));
  }

  if (args.minLevel !== undefined) {
    // A failed repo (report === null) can't be confirmed to meet the gate — treat it as below minLevel.
    const anyBelow = result.results.some(
      (r) => r.report === null || r.report.level.index < (args.minLevel as number),
    );
    if (anyBelow) return { exitCode: 1 };
  }
  return { exitCode: 0 };
}

/** CLI entry point. Tests call this directly with a fake `io`; the real bin (`isMainModule` guard below) uses `defaultIO`. */
export async function main(argv: string[], io: CliIO = defaultIO): Promise<CliResult> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    io.stderr(`harnesslens: ${parsed.error}\n\n${HELP}`);
    return { exitCode: 1 };
  }

  const { args } = parsed;
  if (args.help) {
    io.stdout(HELP);
    return { exitCode: 0 };
  }

  return args.subcommand === 'multi' ? runMultiCommand(args, io) : runAuditCommand(args, io);
}

function isMainModule(): boolean {
  try {
    if (typeof process.argv[1] !== 'string') return false;
    const here = fileURLToPath(import.meta.url);
    return path.resolve(process.argv[1]) === path.resolve(here);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void (async (): Promise<void> => {
    const result = await main(process.argv.slice(2));
    process.exit(result.exitCode);
  })();
}
