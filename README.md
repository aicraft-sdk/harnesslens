# harnesslens

Extensible AI-harness maturity scorer for auditing company repos — how well does each repo
equip an AI coding agent with context, guardrails, and feedback loops?

Built for company-wide use: config-driven check-pack composition (enable/disable/reweight
checks, add custom dimensions), a company-conventions check pack (`ai-craft`), a CLI, a
GitHub Action, and a multi-repo runner for fleet-wide comparisons.

## Quickstart

> This package is currently **private** under the `@ai-craft` npm org while it's being tested;
> installing it requires npm auth as an org member (`npm login` with an account that has read
> access to `@ai-craft`).

```bash
# Install (as a devDependency, or run ad hoc via npx)
pnpm add -D @ai-craft/harnesslens

# Audit the current directory
npx @ai-craft/harnesslens

# Audit a specific repo
npx @ai-craft/harnesslens /path/to/repo
```

## Positioning

`harnesslens` scores how well a **repository** equips an AI coding agent with context,
guardrails, and feedback loops — it is not a certification, and it does not assert compliance
with any standard. Its dimensions are mapped to NIST AI RMF's four functions (Govern/Map/
Measure/Manage) and OWASP's Agentic AI Top 10 risk categories in every report/badge output (see
`--json`'s `frameworkMapping` field) — "maps to"/"aligned to" language only, never an
accreditation or formal-compliance claim; no accredited pass/fail mechanism exists against
either framework today.

This is a different axis than two adjacent tools worth naming explicitly:
- **Factory.ai "Agent Readiness"** scores an org's *agent autonomy readiness* across 9 pillars —
  a different question (how much can you trust an agent to act) than harnesslens's (how well is
  this specific repo harnessed for one).
- **agent-ready.org / Cloudflare's Agent-Ready Scanner** scores a **website's** AI-discoverability
  (llms.txt, schema.org, MCP server cards) — a content-discoverability signal, not a repo
  AI-harness/guardrail-maturity signal.

## Leaderboard (experimental)

An experimental, self-reported leaderboard aggregates `harnesslens --json` scores across
participating repos into a static site. Every entry is self-reported by the scanned repo's
own maintainers and has not been independently verified — treat it as a directional signal,
not an authoritative ranking. See
[`leaderboard/README.md`](./leaderboard/README.md)
for the submission schema and how to submit your repo's score.

## CLI usage

```
harnesslens [path] [options]
harnesslens multi --config <manifest.json> [options]

Options:
  --root <path>         Repo root to audit (default: positional arg, else cwd)
  --json                 Print the full Report as JSON
  --md                   Print the report as Markdown
  --badge <path>         Write an SVG maturity badge to <path>
  --min-level <N>        Exit 1 if the maturity level index is below N
  --config <manifest>    (multi only) JSON manifest of { "repos": [{ "id", "path" }] }
  --help, -h             Show this help and exit
```

Examples:

```bash
# Terminal report for the current repo
harnesslens

# JSON report, gated on at least L2 (Guided) — useful in CI
harnesslens --root . --json --min-level 2

# Markdown report (e.g. to post as a PR comment)
harnesslens --md > harness-report.md

# Write an SVG maturity badge alongside the terminal report
harnesslens --badge ./badge.svg

# Audit a fleet of repos from a manifest
harnesslens multi --config ./repos.json --json
```

When run with no explicit config, the CLI's own default composes the `core` pack (36 ported
upstream checks) **and** the `ai-craft` company pack. Programmatic callers of `runAudit()`
default to `core` only — see [Programmatic API](#programmatic-api) below. A
`.harness-audit.json` file in the target repo overrides both defaults outright.

## Config file

Drop a `.harness-audit.json` in the repo you're auditing to customize which packs/checks run,
add custom dimensions, override the maturity ladder, or widen the scan beyond the repo itself:

```jsonc
{
  // Pack composition: true enables a built-in pack — "core" is the only pack
  // resolvable by `true` (only it is registered as a built-in). Any other
  // pack (including "ai-craft") must be a module path string pointing at a
  // module whose default (or named "pack") export is a CheckPack, or false
  // to disable. Omitting "packs" entirely defaults to `{ core: true }`.
  "packs": {
    "core": true,
    "custom-pack": "./tools/harness-checks/my-pack.js"
  },

  // Per-check overrides, keyed by check id (e.g. "CTX-01", "AIC-01").
  "checks": {
    "CTX-01": { "enabled": false },
    "SKL-02": { "points": 6 }
  },

  // Extra dimensions beyond the 6 core + any pack-declared ones.
  "dimensions": [{ "id": "security", "title": "Security Reviews" }],

  // Maturity-ladder override: exactly 4 entries (L1-L4), each an AND-combined
  // array of requirement specs. Omit to use the default ladder.
  "levels": [
    [{ "dimension": "context", "minPercent": 40 }],
    [
      { "dimension": "context", "minPercent": 60 },
      { "anyOf": [{ "dimension": "skills", "minPercent": 30 }, { "dimension": "hooks", "minPercent": 30 }] },
      { "dimension": "hygiene", "minPercent": 50 }
    ],
    [
      { "dimension": "sensors", "minPercent": 60 },
      { "dimension": "ci", "minPercent": 50 }
    ],
    [
      { "dimension": "hooks", "minPercent": 70 },
      { "totalMinPercent": 80 }
    ]
  ],

  // Extra filesystem roots to scan in addition to the repo itself.
  "extraRoots": [{ "id": "shared-config", "path": "../shared-ai-config" }],
  "scopes": { "user": false, "system": false },

  // Which score --min-level and CI gates use: "maturity" (repo-only, default)
  // or "effective" (repo + configured extra scopes).
  "gate": "maturity"
}
```

Unknown top-level keys and malformed values fail validation with a specific error message
(see `src/config.ts`). To run the `ai-craft` company pack alongside `core`, either omit
`.harness-audit.json` entirely (the CLI's own default enables both) or call `runAudit()`
programmatically and pass the live `aiCraftPack` object in `config.packs` — see
[Programmatic API](#programmatic-api).

## Programmatic API

```ts
import {
  createScanContext,
  buildReportFromScanContext,
  runAudit,
  corePack,
  aiCraftPack,
  renderTerminal,
  renderMarkdown,
  renderBadge,
} from '@ai-craft/harnesslens';

// Lowest-level: build a ScanContext yourself, then score it.
const ctx = createScanContext('/path/to/repo');
const report = buildReportFromScanContext(ctx);
console.log(renderTerminal(report));
console.log(`L${report.level.index} · ${report.level.name} — ${report.score.percent}%`);

// Higher-level: runAudit resolves config (.harness-audit.json or an explicit
// `config`), composes packs, scans, and scores in one call. Defaults to the
// `core` pack only; add `ai-craft` explicitly for company checks.
const auditReport = await runAudit({
  root: '/path/to/repo',
  config: { packs: { core: true, 'ai-craft': aiCraftPack } },
});
console.log(renderMarkdown(auditReport));
console.log(renderBadge(auditReport)); // SVG string
```

Key exports: `createScanContext`, `buildReport` / `buildReportFromContext` /
`buildReportFromScanContext` (the report-building family, from lowest- to highest-level
input), `runAudit` (config-resolving async entry point), `corePack` / `aiCraftPack` (the two
built-in `CheckPack`s), `renderTerminal` / `renderMarkdown` / `renderBadge` (output
renderers), `defineCheck` / `definePack` (typed authoring helpers), `composeRegistry`
(pack → flat check/dimension list), and `runMultiRepoAudit` (see
[Multi-repo usage](#multi-repo-usage)).

## Maturity model

Repos are scored L0-L4 across the 6 core dimensions (plus any pack- or config-declared extra
dimensions, e.g. `ai-craft`'s `company` and `exit-gate` dimensions):

| Dimension | Title |
|---|---|
| `context` | Context & Guides |
| `skills` | Skills & Commands |
| `hooks` | Hooks & Guardrails |
| `sensors` | Sensors & Feedback |
| `ci` | CI Feedback |
| `hygiene` | Hygiene & Safety |

| Level | Name | Requirement (AND-combined) |
|---|---|---|
| L0 | Unharnessed | (default — no requirements met) |
| L1 | Documented | `context` ≥ 40% |
| L2 | Guided | `context` ≥ 60%, (`skills` ≥ 30% OR `hooks` ≥ 30%), `hygiene` ≥ 50% |
| L3 | Sensing | `sensors` ≥ 60%, `ci` ≥ 50% |
| L4 | Self-correcting | `hooks` ≥ 70%, total ≥ 80% |

A level is reached only when **every** requirement in its row is met; the walk stops at the
first unmet level, and `report.level.nextLevelGaps` lists exactly which requirements are
missing. The ladder is fully config-overridable via `.harness-audit.json`'s `levels` key (see
[Config file](#config-file)) — the interpreter lives in `src/level-requirements.ts`.

## Writing a custom check/pack

```ts
import { defineCheck, definePack } from '@ai-craft/harnesslens';

const hasRunbook = defineCheck({
  id: 'CUST-01',
  dimension: 'context',
  title: 'Has an incident runbook',
  points: 2,
  remediation: 'Add a RUNBOOK.md describing on-call steps.',
  run(ctx) {
    return ctx.has('RUNBOOK.md')
      ? { passed: true, evidence: 'RUNBOOK.md found.' }
      : { passed: false, evidence: 'No RUNBOOK.md found.' };
  },
});

export default definePack({ id: 'my-company', checks: [hasRunbook] });
```

Point this pack's module path at `.harness-audit.json`'s `packs["my-company"]` to compose it
in alongside `core`/`ai-craft` (see [Config file](#config-file)).

## GitHub Action usage

```yaml
- uses: actions/checkout@v4
- uses: aicraft-sdk/harnesslens@v1 # replace with the actual published action ref
  with:
    root: '.'
    min-level: '2'
    badge: 'harness-badge.svg'
```

Inputs: `root` (default `.`), `min-level` (fails the step when below this level), `badge`
(path to write an SVG badge), `version` (npm dist-tag/version of `@ai-craft/harnesslens` to
install, default `latest`). Outputs: `level` (resolved maturity level index) and
`score-percent`. See `action/action.yml`.

## Multi-repo usage

```ts
import { runMultiRepoAudit, loadRepoManifest } from '@ai-craft/harnesslens';

const entries = loadRepoManifest('./repos.json'); // { "repos": [{ "id", "path" }] }
const result = await runMultiRepoAudit(entries);
console.log(result.rollup); // { repoCount, averageScorePercent, averageLevelIndex, levelCounts, failedCount }
```

Or via the CLI: `harnesslens multi --config ./repos.json`. Each repo is audited in
parallel and isolated — one bad path or malformed config fails only that entry (see its
`error` field), not the whole run.

## License / attribution

This package is MIT-licensed — see `LICENSE`. See `NOTICE` and `THIRD_PARTY_LICENSES/` for
third-party attribution.

## More

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the scanner, registry, scorer, and renderers
  fit together, and the extension model.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev setup, commands, and PR expectations.
