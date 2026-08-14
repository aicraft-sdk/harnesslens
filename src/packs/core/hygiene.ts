/**
 * Hygiene dimension checks (`checks/hygiene.ts`). See NOTICE for third-party
 * attribution.
 */

import { collectHarnessTextFiles } from '../../harness/collectors.js';
import { mcpConfigPaths } from '../../harness/mcp.js';
import type { Check, ScanContext } from '../../types.js';
import { findSecret, safeJsonParse } from '../../util.js';
import { detectEcosystems } from './sensors.js';

const ENV_FILE_RE = /(^|\/)\.env(\.[^/]+)?$/;
const ENV_TEMPLATE_RE = /\.(example|sample|template|dist)$/;
const CREDENTIAL_WORDS = new Set(['token', 'key', 'secret', 'password', 'passwd', 'auth', 'apikey']);
const ENV_INTERPOLATION_RE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/;
const LATEST_TAG_RE = /@latest\b/i;
/**
 * Runners where the package specifier is a direct positional arg, once flags
 * are skipped (`npx <pkg>`, `uvx <pkg>`, `bunx <pkg>`).
 */
const DIRECT_PACKAGE_RUNNERS = new Set(['npx', 'uvx', 'bunx']);
/**
 * Runners where a SUBCOMMAND must appear first to indicate a one-shot package
 * execution; any other subcommand (`npm run`, `npm install`, `npm ci`, …)
 * means "nothing to check here."
 *
 * `pipx` has no bare `pipx <package>` invocation shape at all — every real
 * pipx CLI usage requires a subcommand (`install`/`run`/`upgrade`/`list`/…).
 * Only `pipx run <pkg>` is the one-shot-execution shape analogous to
 * npx/uvx/bunx, so it belongs here (gated on `run`), not in
 * `DIRECT_PACKAGE_RUNNERS`.
 *
 * Bare `uv` is intentionally NOT included here (only `uvx` is covered) —
 * `uv run --with <dep> --from <pkg> <script>` combines flag-value AND
 * subcommand-gating in a way that's easy to get wrong. This check has
 * oscillated across prior remediation cycles by fixing one reported shape at
 * a time without an explicit inventory of what's in/out of scope; for this
 * one shape we deliberately prefer under-detecting (false negative) over
 * over-flagging (false positive). Do not silently re-add bare `uv` without
 * solving the underlying flag+subcommand ambiguity above.
 *
 * Known accepted gap: `npm`/`pnpm`/`yarn` invocations with a value-taking
 * flag placed BEFORE the subcommand (e.g. a hypothetical
 * `yarn --cwd /path dlx <pkg>`) cause the whole entry to be silently skipped
 * (fail-open), since `pnpm`/`yarn` have no `RUNNER_VALUE_FLAGS` entries to
 * correctly skip such a flag while scanning for the subcommand token itself
 * (`npm` has partial coverage via its own `RUNNER_VALUE_FLAGS` entry, but
 * that entry was built for post-subcommand scanning, not guaranteed to cover
 * every flag npm accepts before the subcommand). Narrow/uncommon shape,
 * accepted as documented risk rather than fixed this cycle.
 */
const SUBCOMMAND_PACKAGE_RUNNERS: Record<string, Set<string>> = {
  npm: new Set(['exec', 'x']),
  pnpm: new Set(['dlx']),
  yarn: new Set(['dlx']),
  pipx: new Set(['run']),
};
/**
 * Flags that consume the NEXT array element as their own value — both the
 * flag and its value must be skipped as a pair when scanning for the
 * positional package arg.
 *
 * `bunx` deliberately has NO entry here: per bun.sh/docs/cli/bunx, its only
 * flags are the boolean `--bun`/`--no-install`/`--verbose`/`--silent` (no
 * separate value, already handled by the generic "leading '-' means flag"
 * fallback below) plus `-p`/`--package`, whose value directly IS the package
 * — that one lives in `RUNNER_PACKAGE_FLAGS` instead. This is a researched,
 * deliberate absence, not an oversight.
 *
 * `pipx`'s entries are for `pipx run` specifically (confirmed against a
 * locally installed `pipx run --help`, v1.5.0): `--python`, `-i`/
 * `--index-url`, and `--pip-args` all consume a separate value that is not
 * itself the package. `--spec` also takes a value but its value directly IS
 * the package to install — that one lives in `RUNNER_PACKAGE_FLAGS.pipx`
 * instead, mirroring `uvx --from`.
 */
const RUNNER_VALUE_FLAGS: Record<string, Set<string>> = {
  npx: new Set(['--prefix', '--registry', '--loglevel', '--cache']),
  npm: new Set(['--prefix', '--registry', '--loglevel', '--cache']),
  uvx: new Set(['--with', '--python', '--index', '--index-url']),
  pipx: new Set(['--python', '-i', '--index-url', '--pip-args']),
};
/** Flags whose value directly IS the package to run (checked instead of a later positional). */
const RUNNER_PACKAGE_FLAGS: Record<string, Set<string>> = {
  npx: new Set(['-p', '--package']),
  uvx: new Set(['--from']),
  bunx: new Set(['-p', '--package']),
  pipx: new Set(['--spec']),
};
/** A package specifier looks pinned when it has "@<digit>" somewhere after its name (scoped or not). */
const PINNED_PACKAGE_REF_RE = /@\d/;
/**
 * npm/pypi-ish package specifier: no leading dash (flag), no path separators.
 *
 * Known accepted gap: `uvx --from <pkg>` (and `pipx run --spec <pkg>`)
 * values containing PEP440 comparison operators (`>=`, `<=`, `~=`, `!=`)
 * bypass this shape match entirely and are silently treated as "not
 * obviously unpinned" — a floating range like `mcp-server-fetch>=1.2.3` is
 * never flagged, only exact `==`/`@`-style pins are recognized. Accepted
 * false-negative, not a false-positive; not fixed this cycle.
 */
const PACKAGE_ARG_RE = /^@?[a-z0-9][\w.-]*(?:\/[a-z0-9][\w.-]*)?$/i;
/** A version tag, release path, or pinned commit ref inside a remote URL. */
const URL_VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?\b|#[0-9a-f]{7,40}\b|\/tags\/|\/releases\//i;
/** Recursion depth cap for collectServerEntries, mirroring MAX_DEPTH/OVERLAY_MAX_DEPTH elsewhere. */
const SERVER_ENTRIES_MAX_DEPTH = 50;

/**
 * A key is credential-shaped only if one of its camelCase/snake_case/kebab-case
 * segments is a credential word (allowing a simple trailing-"s" plural, since
 * an array of secrets is commonly named "apiKeys"/"tokens") — "apiKey" and
 * "API_TOKENS" match, but "authorName" and "keyword" don't (substring
 * matching flagged those).
 */
function isCredentialShapedKey(key: string): boolean {
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[_\-\s]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
  return segments.some(
    (s) => CREDENTIAL_WORDS.has(s) || (s.endsWith('s') && CREDENTIAL_WORDS.has(s.slice(0, -1))),
  );
}

/**
 * Recursively collect stringified values of credential-shaped keys
 * (token/key/secret/password/…). An array found under a credential-shaped
 * key is treated as a list of credential values itself — not recursed into
 * generically — so e.g. `"apiKeys": ["sk-...", "sk-..."]` still surfaces
 * both literals instead of losing the key context on recursion.
 */
function credentialShapedValues(node: unknown, keyIsCredential = false): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item) => {
      if (
        keyIsCredential &&
        (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
      ) {
        return [String(item)];
      }
      return credentialShapedValues(item);
    });
  }
  if (!node || typeof node !== 'object') return [];
  const values: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const credential = isCredentialShapedKey(key);
    if (
      credential &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      values.push(String(value));
    } else if (Array.isArray(value)) {
      values.push(...credentialShapedValues(value, credential));
    } else if (value && typeof value === 'object') {
      values.push(...credentialShapedValues(value));
    }
  }
  return values;
}

/**
 * Recursively find every object that looks like an MCP server entry (has a
 * string `command` or `url`), regardless of the wrapper key
 * (`mcpServers`/`servers`/flat) different tools use.
 */
function collectServerEntries(node: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > SERVER_ENTRIES_MAX_DEPTH) return [];
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => collectServerEntries(item, depth + 1));
  const obj = node as Record<string, unknown>;
  const out: Array<Record<string, unknown>> = [];
  if (typeof obj.command === 'string' || typeof obj.url === 'string') out.push(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') out.push(...collectServerEntries(value, depth + 1));
  }
  return out;
}

/**
 * Scans `args[startIndex..]` for the runner's package token:
 * - a `RUNNER_PACKAGE_FLAGS` match returns its value immediately (that flag's
 *   value directly *is* the package to run, e.g. `uvx --from <pkg> <cmd>`);
 * - a `RUNNER_VALUE_FLAGS` match skips both the flag and its value (e.g.
 *   `npx --prefix <path> <pkg>`);
 * - any other flag (leading `-`) is skipped on its own;
 * - the first true positional token found is returned.
 * Returns undefined if none found before the array ends.
 */
function findPositionalPackageArg(
  runnerBase: string,
  args: string[],
  startIndex: number,
): { token: string; index: number } | undefined {
  const packageFlags = RUNNER_PACKAGE_FLAGS[runnerBase];
  const valueFlags = RUNNER_VALUE_FLAGS[runnerBase];
  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];
    if (packageFlags?.has(arg)) {
      const value = args[i + 1];
      return value !== undefined ? { token: value, index: i + 1 } : undefined;
    }
    if (valueFlags?.has(arg)) {
      i++; // also skip the flag's own value
      continue;
    }
    if (arg.startsWith('-')) continue;
    return { token: arg, index: i };
  }
  return undefined;
}

/**
 * Top-level package-arg lookup for a runner invocation.
 * - `DIRECT_PACKAGE_RUNNERS`: scan from index 0 (`npx <pkg>`, `uvx <pkg>`, …).
 * - `SUBCOMMAND_PACKAGE_RUNNERS`: the first non-flag token must be a
 *   recognized subcommand for that runner (`npm exec`, `pnpm dlx`, …) — if
 *   not, there's nothing to check here (e.g. `npm run build`); if it is,
 *   scan again starting just past that subcommand for the actual package
 *   token.
 * - Any other runner base (including bare `uv` — see
 *   `SUBCOMMAND_PACKAGE_RUNNERS` doc comment): returns undefined.
 */
function findPackageArg(runnerBase: string, args: string[]): string | undefined {
  if (DIRECT_PACKAGE_RUNNERS.has(runnerBase)) {
    return findPositionalPackageArg(runnerBase, args, 0)?.token;
  }
  const subcommands = SUBCOMMAND_PACKAGE_RUNNERS[runnerBase];
  if (!subcommands) return undefined;
  const first = findPositionalPackageArg(runnerBase, args, 0);
  if (!first || !subcommands.has(first.token)) return undefined;
  return findPositionalPackageArg(runnerBase, args, first.index + 1)?.token;
}

/** Returns a human-readable reason when a server entry looks unpinned/floating, else null. */
function unpinnedServerReason(entry: Record<string, unknown>): string | null {
  const command = typeof entry.command === 'string' ? entry.command : '';
  const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === 'string') : [];
  const url = typeof entry.url === 'string' ? entry.url : '';

  for (const s of [command, ...args, url]) {
    if (s && LATEST_TAG_RE.test(s)) return `uses a floating "@latest" tag ("${s}")`;
  }

  const runnerBase = command.split(/[\\/]/).pop() ?? command;
  const packageArg = findPackageArg(runnerBase, args);
  if (packageArg && PACKAGE_ARG_RE.test(packageArg) && !PINNED_PACKAGE_REF_RE.test(packageArg)) {
    return `references package "${packageArg}" with no version specifier`;
  }

  if (/^https?:\/\//i.test(url) && !URL_VERSION_RE.test(url)) {
    return `remote URL has no version/commit/tag segment ("${url}")`;
  }

  return null;
}

function gitignoreCoversEnv(ctx: ScanContext): boolean {
  const content = ctx.read('.gitignore');
  if (content === null) return false;
  return content.split(/\r?\n/).some((l) => /^\s*\*?\*?\/?\.env/.test(l.trim()));
}

const LOCKFILES: Array<{ file: string; ecosystems: string[] }> = [
  { file: 'package-lock.json', ecosystems: ['node'] },
  { file: 'pnpm-lock.yaml', ecosystems: ['node'] },
  { file: 'yarn.lock', ecosystems: ['node'] },
  { file: 'bun.lockb', ecosystems: ['node'] },
  { file: 'bun.lock', ecosystems: ['node'] },
  { file: 'uv.lock', ecosystems: ['python'] },
  { file: 'poetry.lock', ecosystems: ['python'] },
  { file: 'Pipfile.lock', ecosystems: ['python'] },
  { file: 'requirements.txt', ecosystems: ['python'] },
  { file: 'go.sum', ecosystems: ['go'] },
  { file: 'Cargo.lock', ecosystems: ['rust'] },
  { file: 'composer.lock', ecosystems: ['php'] },
  { file: 'Gemfile.lock', ecosystems: ['ruby'] },
];

export const hygieneChecks: Check[] = [
  {
    id: 'HYG-01',
    dimension: 'hygiene',
    title: '.gitignore present',
    points: 2,
    remediation:
      'Add a .gitignore — agents commit what they see; make sure build output and local state are invisible.',
    run(ctx) {
      return ctx.has('.gitignore')
        ? { passed: true, evidence: '.gitignore found at repository root.' }
        : { passed: false, evidence: 'No .gitignore at repository root.' };
    },
  },
  {
    id: 'HYG-02',
    dimension: 'hygiene',
    title: '.gitignore covers environment files',
    points: 3,
    remediation: 'Add ".env" and ".env.*" to .gitignore so an agent can never stage credentials by accident.',
    run(ctx) {
      if (!ctx.has('.gitignore')) {
        return { passed: false, evidence: 'No .gitignore to inspect.' };
      }
      return gitignoreCoversEnv(ctx)
        ? { passed: true, evidence: '.gitignore contains a .env pattern.' }
        : { passed: false, evidence: '.gitignore has no .env pattern.' };
    },
  },
  {
    id: 'HYG-03',
    dimension: 'hygiene',
    title: 'No unprotected .env files in the tree',
    points: 4,
    remediation:
      "Remove committed .env files (keep only .env.example) or at minimum ensure .gitignore excludes them — env files in an agent's working tree leak into context and commits.",
    run(ctx) {
      const envFiles = ctx.files.filter((f) => ENV_FILE_RE.test(f) && !ENV_TEMPLATE_RE.test(f));
      if (envFiles.length === 0) {
        return {
          passed: true,
          evidence: 'No real .env files in the tree (templates like .env.example are fine).',
        };
      }
      const covered = gitignoreCoversEnv(ctx);
      return covered
        ? { passed: true, evidence: `${envFiles.length} .env file(s) present but covered by .gitignore.` }
        : { passed: false, evidence: `Unignored env file(s): ${envFiles.slice(0, 3).join(', ')}.` };
    },
  },
  {
    id: 'HYG-04',
    dimension: 'hygiene',
    title: 'MCP configuration free of credentials',
    points: 4,
    remediation:
      'Never inline API keys in MCP config (.cursor/mcp.json, .mcp.json, .agents/mcp_config.json) — use ${VAR} interpolation and document required variables in .env.example.',
    run(ctx) {
      const mcpFiles = mcpConfigPaths(ctx);
      if (mcpFiles.length === 0) {
        return { passed: true, evidence: 'No MCP config in repository (nothing to leak).' };
      }
      for (const file of mcpFiles) {
        const content = ctx.read(file) ?? '';
        const secret = findSecret(content);
        if (secret) {
          return { passed: false, evidence: `${file} contains what looks like a ${secret}.` };
        }
      }
      return { passed: true, evidence: `${mcpFiles.join(', ')}: no credential signatures found.` };
    },
  },
  {
    id: 'HYG-05',
    dimension: 'hygiene',
    title: 'License present',
    points: 2,
    remediation: 'Add a LICENSE file — required for open-source distribution and plugin marketplaces.',
    run(ctx) {
      const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].find((f) => ctx.has(f));
      return license
        ? { passed: true, evidence: `Found ${license}.` }
        : { passed: false, evidence: 'No LICENSE file at repository root.' };
    },
  },
  {
    id: 'HYG-06',
    dimension: 'hygiene',
    title: 'No credential signatures in harness files',
    points: 2,
    remediation:
      'Remove any API keys or tokens from AGENTS.md, rules, and hooks configuration — harness files are loaded into model context on every session.',
    run(ctx) {
      const harnessFiles = collectHarnessTextFiles(ctx);
      for (const file of harnessFiles) {
        const secret = findSecret(ctx.read(file) ?? '');
        if (secret) {
          return { passed: false, evidence: `${file} contains what looks like a ${secret}.` };
        }
      }
      return {
        passed: true,
        evidence:
          harnessFiles.length > 0
            ? `Scanned ${harnessFiles.length} harness file(s); no credential signatures.`
            : 'No harness files present to scan.',
      };
    },
  },
  {
    id: 'HYG-07',
    dimension: 'hygiene',
    title: 'Dependency lockfile committed',
    points: 3,
    remediation:
      "Commit the lockfile (package-lock.json, uv.lock, Cargo.lock…) — reproducible installs mean the agent's sensors run against the same dependencies everywhere.",
    run(ctx) {
      const ecosystems = detectEcosystems(ctx);
      const lockable = LOCKFILES.filter((l) =>
        l.ecosystems.some((e) => (ecosystems as string[]).includes(e)),
      );
      if (lockable.length === 0) {
        return {
          passed: true,
          evidence:
            ecosystems.length === 0
              ? 'No dependency manifest detected (nothing to lock).'
              : `No lockfile convention applies to: ${ecosystems.join(', ')}.`,
        };
      }
      const found = lockable.find((l) => ctx.has(l.file));
      return found
        ? { passed: true, evidence: `Found ${found.file}.` }
        : {
            passed: false,
            evidence: `Manifest present but no lockfile (expected one of: ${[...new Set(lockable.map((l) => l.file))].join(', ')}).`,
          };
    },
  },
  {
    id: 'HYG-08',
    dimension: 'hygiene',
    title: 'MCP config uses env interpolation for credentials',
    points: 3,
    remediation:
      'Reference credential-shaped values in MCP config via ${ENV_VAR} interpolation instead of literals — this rewards deliberate, safe tool-access configuration.',
    run(ctx) {
      const mcpFiles = mcpConfigPaths(ctx);
      if (mcpFiles.length === 0) {
        return {
          passed: false,
          evidence: 'No MCP config found (.cursor/mcp.json, .mcp.json, or .agents/mcp_config.json).',
        };
      }
      for (const file of mcpFiles) {
        const content = ctx.read(file) ?? '';
        if (findSecret(content)) {
          return { passed: false, evidence: `${file} contains a literal credential signature (see HYG-04).` };
        }
        const parsed = safeJsonParse(content);
        if (parsed === undefined) {
          return { passed: false, evidence: `${file} is not valid JSON.` };
        }
        const credentialValues = credentialShapedValues(parsed);
        const uninterpolated = credentialValues.filter((v) => !ENV_INTERPOLATION_RE.test(v));
        if (uninterpolated.length > 0) {
          return {
            passed: false,
            evidence: `${file} has credential-shaped field(s) not using \${VAR} interpolation.`,
          };
        }
      }
      return {
        passed: true,
        evidence: `${mcpFiles.join(', ')}: valid, and any credential-shaped fields use \${VAR} interpolation.`,
      };
    },
  },
  {
    id: 'HYG-09',
    dimension: 'hygiene',
    title: 'MCP servers reference pinned sources',
    points: 3,
    remediation:
      'Pin MCP server versions/commits instead of floating tags — a compromised or drifted MCP server can redirect agent tool calls.',
    run(ctx) {
      const mcpFiles = mcpConfigPaths(ctx);
      if (mcpFiles.length === 0) {
        return { passed: true, evidence: 'No MCP config in repository (nothing to pin).' };
      }
      for (const file of mcpFiles) {
        const content = ctx.read(file) ?? '';
        const parsed = safeJsonParse(content);
        if (parsed === undefined) {
          return { passed: false, evidence: `${file} is not valid JSON.` };
        }
        for (const entry of collectServerEntries(parsed)) {
          const reason = unpinnedServerReason(entry);
          if (reason) {
            return { passed: false, evidence: `${file}: ${reason}.` };
          }
        }
      }
      return { passed: true, evidence: `${mcpFiles.join(', ')}: all MCP server references look pinned.` };
    },
  },
];
