# Architecture

How `@ai-craft/harness-audit` turns a repository on disk into a maturity report, and how to
extend it without forking.

## The pipeline

```
repo root
  │
  ▼
createScanContext(root)          src/scan.ts
  → walks the filesystem (skipping .git, node_modules, dist, etc., capped at
    MAX_DEPTH/MAX_FILES/MAX_READ_BYTES) into a ScanContext: { files, has(),
    read(), matching() }. Checks never touch the filesystem directly — they
    only see this context.
  │
  ▼
composeRegistry({ packs, checkOverrides, extraDimensions })   src/registry.ts
  → flattens one or more CheckPacks (each a { id, checks: Check[],
    dimensions? }) into a single ComposedRegistry: { checks, dimensions }.
    Duplicate check ids across packs throw. checkOverrides can disable a
    check or reweight its points; extraDimensions adds dimensions beyond the
    6 core ones and whatever the packs themselves declare.
  │
  ▼
buildReportFromContext(ctx, ctx, config, ..., registry, requirements)  src/score.ts
  → runs every Check.run(ctx) in the registry, aggregates each dimension's
    earned/max points into a DimensionScore, and produces per-check
    CheckResults (pass/fail + evidence + remediation + docsUrl).
  │
  ▼
computeLevel(dimensions, totalPercent, requirements)   src/level-requirements.ts
  → walks the L1-L4 ladder (an array of AND-combined LevelRequirementSpecs),
    stopping at the first unmet level and recording its unmet specs as
    nextLevelGaps.
  │
  ▼
renderTerminal / renderMarkdown / renderBadge (report)   src/report/*.ts
  → format the same Report object for a terminal, a Markdown doc (e.g. a PR
    comment), or an SVG badge.
```

`runAudit({ root, config })` (`src/api.ts`) is the single async entry point that wires this
whole pipeline together: it resolves config (explicit `config` param, else
`.harness-audit.json` in `root`, else defaults), resolves and composes packs, builds the
`ScanContext`(s), and calls `buildReportFromContext`. The CLI (`src/cli.ts`) is a thin wrapper
around `runAudit` plus the three renderers — no scoring logic lives in the CLI itself.

## The extension model

A **`Check`** is the atomic unit: `{ id, dimension, title, points, remediation, run(ctx) }`,
where `run` returns `{ passed, evidence }`. A **`CheckPack`** is a named bundle of checks
(`{ id, checks: Check[], dimensions?: DimensionInfo[] }`) that can also declare its own custom
dimensions (e.g. the `ai-craft` pack's `company` dimension). `defineCheck`/`definePack`
(`src/define.ts`) are identity functions — they exist purely to give editors type-safe
autocomplete when authoring a literal, matching the `defineConfig`-style helper convention
used elsewhere.

Config-driven composition (`.harness-audit.json`, validated and resolved in `src/config.ts`)
lets a target repo, without forking this package:

- enable/disable a built-in pack, or point `packs.<id>` at a module path (dynamically
  `import()`ed at audit time — see `resolvePackEntry` in `src/api.ts`) or, for programmatic
  callers, a live `CheckPack` object;
- disable an individual check or reweight its `points` (`checks.<id>.enabled` /
  `checks.<id>.points`);
- add dimensions beyond the base 6 (`dimensions`);
- override the L1-L4 maturity ladder (`levels`);
- widen the scan beyond the repo root (`extraRoots`, `scopes.user`/`scopes.system`) and choose
  which score CI gates on (`gate: "maturity" | "effective"`).

`composeRegistry` (`src/registry.ts`) is where packs, overrides, and extra dimensions all get
flattened into the single `{ checks, dimensions }` list `score.ts` scores against — this is
the seam that makes multi-pack composition possible without any pack knowing about any other.

## Future direction (not yet scoped)

This package's role today is a check-pack scorer consumed by CI (the GitHub Action) and by
humans (CLI/badge). A larger idea surfaced during the `exit-gate` check-pack work (which added
`AIC-11..AIC-17`) and, more directly, while deciding **not** to couple craftflow's own live
BUILD path to this package: an earlier plan ("Phase B" — craftflow shelling out to this CLI at
BUILD-verify time) was explicitly rejected, because craftflow is mirrored to a separate,
externally-consumed `craftflow-public` repo and cannot depend on an unpublished,
ai-craft-specific package without breaking for anyone using craftflow outside this monorepo:

`harness-audit` could grow beyond a library/CLI that other tools invoke into a standalone
**badge / certification system** in its own right — something repos (inside or outside this
monorepo) opt into for an externally-visible maturity signal, rather than a scorer that only
exists as an input to someone else's pipeline.

This is explicitly **not scoped** — no design decisions below have been made. A future PLAN
workflow would need to work out, at minimum:

- What "certification" actually means here: a public badge API, signed/verifiable
  attestations, a hosted leaderboard across repos, tiered public/private scoring, or some
  combination.
- Whether this implies a hosted service (this package is currently zero-network,
  filesystem-only by design — see "Determinism/safety guarantees" above — so any hosted
  component would be a new surface, not an extension of the existing scorer).
- How it relates to the existing `runMultiRepoAudit` rollup, which already aggregates
  fleet-wide scores but has no public/external-facing surface today.
- **A real detection gap found while prototyping a self-audit badge for craftflow itself**:
  running this package's own CLI against `tools/craftflow-plugin` (a Claude Code plugin bundle
  — `plugins/<name>/skills/`, `plugins/<name>/agents/`, etc.) scored `L0 Unharnessed, 15%`, even
  though craftflow demonstrably has 11 agents, 24 skills, and 24 hooks. The core/ai-craft checks
  assume repo-root conventions (root `AGENTS.md`, root `.claude/skills/`, root `.github/
  workflows/`) that a nested plugin bundle intentionally doesn't follow at its own top level.
  Any future badge/certification product needs either a "plugin-shaped repo" detection mode or
  a configurable path-root remap before it can score something like craftflow fairly — shipping
  a badge without this would actively mislead (a low score sitting next to prose describing a
  mature toolset). No fix attempted here; flagging so the future PLAN scopes it explicitly
  rather than rediscovering it.

Capturing the idea here so it isn't lost — not a commitment to build it.

## The two built-in packs

- **`core`** (`src/packs/core/`) — the 36 checks ported from upstream `harness-score`,
  reorganized one file per dimension-ish grouping (`context.ts`, `skills.ts`, `agents.ts`,
  `hooks.ts`, `sensors.ts`, `ci.ts`, `hygiene.ts`) and assembled into a single `corePack` via
  `definePack`. `ALL_CHECKS` remains exported as a backward-compatible alias for
  `corePack.checks`.
- **`ai-craft`** (`src/packs/ai-craft/`) — company-specific checks this monorepo's own manual
  audit surfaced as gaps in `core`'s repo-root-only detection. The headline motivator is
  **plugin-harness detection** (`plugin-detection.ts`): `core`'s checks only look for
  standard repo-root paths (`.claude/skills/`, `.cursor/rules/`, etc.), so a harness
  *delivered as a plugin* — this monorepo's own
  `tools/<plugin>/plugins/<name>/skills|agents|hooks/...` layout — scored as a false negative
  under `core` alone. Detection is structural (a path-shape regex), not name-coupled to any
  one plugin. The pack also adds NX/changesets release-convention checks
  (`monorepo.ts`), AI-First governance/spec-traceability checks (`governance.ts`), and two
  hygiene template checks (`hygiene.ts`) — all scored under a dedicated `company` dimension.
  A second constituent, `exit-gate.ts`, scores Addy Osmani's 7 agent-output "exit gate" quality
  dimensions (mutation testing, security, accessibility, performance, cost, maintainability,
  comprehensibility) as static CI/config-presence readiness checks (`AIC-11`-`AIC-17`) under
  its own `exit-gate` dimension — see the Decision RFC at
  `docs/plans/2026-08-11-agent-exit-gate-quality-dimensions-rfc.md`. Both `company` and
  `exit-gate` are additive to, never mixed into, `core`'s 6 dimensions.

## Determinism/safety guarantees

This is a core design tenet, not an implementation detail: **zero network calls, zero LLM
calls, read-only filesystem access.** Every check runs purely against the in-memory
`ScanContext` built once per scan; nothing under `src/` makes an HTTP request, shells out, or
mutates the target repo. The one place output is written to disk is the CLI's `--badge <path>`
flag, which is an explicit, opt-in write of an SVG string the caller asked for — never touched
without that flag. The multi-repo runner (`src/multi-repo.ts`) upholds the same guarantee
explicitly as an exit criterion: no `Date.now()`/random ids/unstable key ordering anywhere in
that file, so auditing the same set of repo paths twice produces byte-identical JSON output.

## Why fork instead of depend on upstream

`harness-score` is a well-scoped, single-purpose CLI tool with a hardcoded check catalog.
Auditing a fleet of company repos needs three things upstream doesn't offer as a library:
config-driven pack composition (enable/disable/reweight checks per repo, add custom
dimensions), a place to encode company-specific conventions (NX/changesets, AI-First
governance, and — critically — non-repo-root plugin-harness detection, which upstream's
detection logic structurally cannot see), and a multi-repo rollup for comparing repos
fleet-wide. None of these are reasonably expressible as configuration on top of upstream's
existing single-pack, repo-root-only design; forking and building the pack/registry extension
layer on top (`registry.ts`, `config.ts`, `define.ts`) was the smallest change that made this
package's own checks (`ai-craft`) and any future company packs first-class citizens rather
than patches carried against someone else's CLI.
