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
import { buildSignedSubmissionBody } from './evidence-package.js';
import { generateAndSaveSigningKey, loadSigningKey } from './keys.js';
import { aiCraftPack } from './packs/ai-craft/index.js';
import { renderBadge } from './report/badge.js';
import { renderMarkdown } from './report/markdown.js';
import { renderTerminal } from './report/terminal.js';
import { loadRepoManifest, runMultiRepoAudit, type MultiRepoReport } from './multi-repo.js';
import { verifyPackage } from './verify-package.js';

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
  harnesslens keygen [--force]
  harnesslens submit <path> --sign --repo-id <org/repo> --commit-sha <sha> --key-id <uuid> --api-url <url>
  harnesslens verify-package <submission-id> --api-url <url>

Options:
  --root <path>        Repo root to audit (default: positional arg, else cwd)
  --json                Print the full Report as JSON
  --md                  Print the report as Markdown
  --badge <path>        Write an SVG maturity badge to <path>
  --min-level <N>        Exit 1 if the maturity level index is below N
  --config <manifest>    (multi only) JSON manifest of { "repos": [{ "id", "path" }] }
  --force               (keygen only) overwrite an existing signing key
  --sign                 (submit only) required -- sign the submission with the local key
  --repo-id <org/repo>   (submit only) required
  --commit-sha <sha>     (submit only) required
  --key-id <uuid>        (submit only) required -- the keyId returned by signing-key registration
  --api-url <url>        (submit and verify-package only) required -- backend base URL, e.g. https://api.example.com
  --help, -h            Show this help and exit
`;

interface ParsedArgs {
  subcommand: 'audit' | 'multi' | 'keygen' | 'submit' | 'verify-package';
  root: string;
  json: boolean;
  md: boolean;
  badgePath?: string;
  minLevel?: number;
  manifestPath?: string;
  force: boolean;
  sign: boolean;
  repoId?: string;
  commitSha?: string;
  keyId?: string;
  apiUrl?: string;
  submissionId?: string;
  help: boolean;
}

type ParseResult = { args: ParsedArgs } | { error: string };

function parseArgs(argv: string[]): ParseResult {
  const rest = [...argv];
  let subcommand: ParsedArgs['subcommand'] = 'audit';
  if (rest[0] === 'multi') {
    subcommand = 'multi';
    rest.shift();
  } else if (rest[0] === 'keygen') {
    subcommand = 'keygen';
    rest.shift();
  } else if (rest[0] === 'submit') {
    subcommand = 'submit';
    rest.shift();
  } else if (rest[0] === 'verify-package') {
    subcommand = 'verify-package';
    rest.shift();
  }

  let root: string | undefined;
  let json = false;
  let md = false;
  let badgePath: string | undefined;
  let minLevel: number | undefined;
  let manifestPath: string | undefined;
  let force = false;
  let sign = false;
  let repoId: string | undefined;
  let commitSha: string | undefined;
  let keyId: string | undefined;
  let apiUrl: string | undefined;
  let submissionId: string | undefined;
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
      case '--force':
        force = true;
        break;
      case '--sign':
        sign = true;
        break;
      case '--repo-id': {
        const value = rest[i + 1];
        if (!value) return { error: '--repo-id requires an argument' };
        repoId = value;
        i += 1;
        break;
      }
      case '--commit-sha': {
        const value = rest[i + 1];
        if (!value) return { error: '--commit-sha requires an argument' };
        commitSha = value;
        i += 1;
        break;
      }
      case '--key-id': {
        const value = rest[i + 1];
        if (!value) return { error: '--key-id requires an argument' };
        keyId = value;
        i += 1;
        break;
      }
      case '--api-url': {
        const value = rest[i + 1];
        if (!value) return { error: '--api-url requires an argument' };
        apiUrl = value;
        i += 1;
        break;
      }
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
        if (subcommand === 'verify-package') {
          if (submissionId !== undefined) return { error: `unexpected argument: ${arg}` };
          submissionId = arg;
          break;
        }
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
      force,
      sign,
      repoId,
      commitSha,
      keyId,
      apiUrl,
      submissionId,
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

/** `harnesslens keygen [--force]` -- generates and saves an Ed25519 signing key, then prints the
 * public key plus a copy-pasteable registration command. Never prints the private key. */
async function runKeygenCommand(io: CliIO, force: boolean): Promise<CliResult> {
  try {
    const { publicKeyBase64, keyFilePath } = generateAndSaveSigningKey({ force });
    io.stdout(`Ed25519 signing key generated and saved to ${keyFilePath} (permissions 0600).\n`);
    io.stdout(`Public key (base64): ${publicKeyBase64}\n\n`);
    io.stdout('Register it with your account (replace <accountId>, <apiKey> with your own):\n');
    io.stdout(
      `  curl -X POST <api-url>/accounts/<accountId>/signing-keys \\\n` +
        `    -H "Authorization: Bearer <apiKey>" -H "Content-Type: application/json" \\\n` +
        `    -d '{"publicKey":"${publicKeyBase64}"}'\n\n`,
    );
    io.stdout('Save the returned keyId -- pass it to `harnesslens submit --sign --key-id <keyId>`.\n');
    return { exitCode: 0 };
  } catch (error) {
    io.stderr(`harnesslens keygen: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }
}

/** `harnesslens submit <path> --sign --repo-id <org/repo> --commit-sha <sha> --key-id <uuid>
 * --api-url <url>` -- runs a scan, builds+signs the evidence package (Task 5.2), and POSTs it to
 * `<api-url>/submissions`. `--sign` is always required (Durable Decision 9 -- this CLI never adds
 * an unsigned submission path); `--repo-id`/`--commit-sha` are always explicit flags, never
 * auto-detected via a `git` shell-out (Durable Decision 11). */
async function runSubmitCommand(args: ParsedArgs, io: CliIO, fetchImpl: typeof fetch): Promise<CliResult> {
  if (!args.sign) {
    io.stderr('harnesslens submit: --sign is required (this CLI only submits signed evidence packages)\n');
    return { exitCode: 1 };
  }
  for (const [field, flag] of [
    ['repoId', '--repo-id'],
    ['commitSha', '--commit-sha'],
    ['keyId', '--key-id'],
    ['apiUrl', '--api-url'],
  ] as const) {
    if (!args[field]) {
      io.stderr(`harnesslens submit: ${flag} is required\n`);
      return { exitCode: 1 };
    }
  }

  let privateKey: ReturnType<typeof loadSigningKey>['privateKey'];
  try {
    ({ privateKey } = loadSigningKey());
  } catch (error) {
    io.stderr(`harnesslens submit: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }

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

  const body = buildSignedSubmissionBody(report, {
    repoId: args.repoId as string,
    commitSha: args.commitSha as string,
    keyId: args.keyId as string,
    privateKey,
  });

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetchImpl(`${args.apiUrl}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    io.stderr(`harnesslens submit: request failed — ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 1 };
  }

  // Parsed regardless of `response.ok` -- a rejection (e.g. 400) still carries a JSON `message`
  // field this CLI surfaces to the user. A parse failure is handled differently depending on
  // `response.ok`: on the error path, a non-JSON body (e.g. an upstream proxy's HTML error page)
  // is tolerated and falls back to `{}` (the status text still gets surfaced below). On the
  // success path, a parse failure means the server claimed success but returned a body this CLI
  // cannot trust -- silently defaulting to `{}` there would report `id=undefined
  // verified=undefined` as if the submission succeeded, so it is treated as a hard error instead.
  let responseBody: { id?: string; verified?: boolean; message?: string };
  try {
    responseBody = (await response.json()) as { id?: string; verified?: boolean; message?: string };
  } catch (error) {
    if (response.ok) {
      io.stderr(
        `harnesslens submit: server returned ${response.status} but the response body could not be parsed as JSON — ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return { exitCode: 1 };
    }
    responseBody = {};
  }

  // `response.json()` only rejects for genuinely invalid JSON syntax -- valid-but-useless JSON
  // like the literal `null` (or a JSON array/primitive) parses successfully without hitting the
  // catch above. Guard explicitly before any property access on either branch below, otherwise
  // `responseBody.id`/`.message` would throw a raw TypeError for a `null` response body.
  if (responseBody === null || typeof responseBody !== 'object') {
    if (response.ok) {
      io.stderr(
        `harnesslens submit: server returned ${response.status} with an unexpected response body (not a JSON object)\n`,
      );
      return { exitCode: 1 };
    }
    responseBody = {};
  }

  if (!response.ok) {
    io.stderr(
      `harnesslens submit: server rejected the submission (${response.status}) — ${responseBody.message ?? response.statusText ?? 'unknown error'}\n`,
    );
    return { exitCode: 1 };
  }

  io.stdout(`Submission accepted: id=${responseBody.id} verified=${responseBody.verified}\n`);
  return { exitCode: 0 };
}

/** `harnesslens verify-package <submission-id> --api-url <url>` -- fetches
 * `GET /submissions/:id/evidence`, rebuilds the canonical payload locally, and verifies the
 * signature independently of the backend's own claim (Task 6.1's `verifyPackage`). Prints only
 * guard-safe language -- never claims certification or an audited-secure status, "signature
 * valid/invalid" only (`no-certification-claims.spec.ts`). */
async function runVerifyPackageCommand(args: ParsedArgs, io: CliIO, fetchImpl: typeof fetch): Promise<CliResult> {
  if (!args.submissionId) {
    io.stderr('harnesslens verify-package: a submission id is required\n');
    return { exitCode: 1 };
  }
  if (!args.apiUrl) {
    io.stderr('harnesslens verify-package: --api-url is required\n');
    return { exitCode: 1 };
  }

  const result = await verifyPackage(args.submissionId, args.apiUrl, fetchImpl);
  if (result.valid) {
    io.stdout('harnesslens verify-package: signature VALID -- the evidence package matches what was signed.\n');
    return { exitCode: 0 };
  }
  io.stdout(`harnesslens verify-package: signature INVALID -- ${result.reason}.\n`);
  return { exitCode: 1 };
}

export interface CliDeps {
  fetchImpl?: typeof fetch;
}

/** CLI entry point. Tests call this directly with a fake `io`; the real bin (`isMainModule` guard below) uses `defaultIO`. */
export async function main(argv: string[], io: CliIO = defaultIO, deps: CliDeps = {}): Promise<CliResult> {
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

  if (args.subcommand === 'keygen') {
    return runKeygenCommand(io, args.force);
  }
  if (args.subcommand === 'submit') {
    return runSubmitCommand(args, io, deps.fetchImpl ?? fetch);
  }
  if (args.subcommand === 'verify-package') {
    return runVerifyPackageCommand(args, io, deps.fetchImpl ?? fetch);
  }
  return args.subcommand === 'multi' ? runMultiCommand(args, io) : runAuditCommand(args, io);
}

function isMainModule(): boolean {
  try {
    if (typeof process.argv[1] !== 'string') return false;
    const here = fileURLToPath(import.meta.url);
    // process.argv[1] may be a bin symlink (npx/global/local npm installs all invoke the
    // CLI through one) — path.resolve() does not dereference symlinks, so it must be
    // realpath'd before comparing against the ESM-resolved (already-real) `here` path.
    return fs.realpathSync(process.argv[1]) === here;
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
