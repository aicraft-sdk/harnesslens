# @ai-craft/harness-audit

Extensible AI-harness maturity scorer for auditing company repos. Forked from
[`paladini/harness-score`](https://github.com/paladini/harness-score) (MIT) and ported as a
built-in `core` check pack — see `NOTICE` for attribution.

**Phase 1 (this release):** the ported scoring engine + the 36 upstream checks, wired as a
single hardcoded `core` pack. Config-driven pack composition, the `ai-craft` company check
pack, and the CLI/Action/multi-repo runner are later phases — see
`docs/ai/specs/0011-harness-audit.md`.

## Usage

```ts
import { createScanContext, buildReportFromScanContext, renderTerminal } from '@ai-craft/harness-audit';

const ctx = createScanContext('/path/to/repo');
const report = buildReportFromScanContext(ctx);
console.log(renderTerminal(report));
console.log(`L${report.level.index} · ${report.level.name}`);
```

## API

```ts
createScanContext(root: string): ScanContext
buildReport(root: string, config?: ResolvedScanConfig): Report
buildReportFromScanContext(ctx: ScanContext): Report
corePack: { id: 'core', checks: Check[] } // the 36 ported upstream checks
renderTerminal(report: Report): string
renderMarkdown(report: Report): string
renderBadge(report: Report): string
```

## Maturity model

L0 Unharnessed → L1 Documented → L2 Guided → L3 Sensing → L4 Self-correcting, scored across
6 dimensions: Context & Guides, Skills & Commands, Hooks & Guardrails, Sensors & Feedback,
CI Feedback, Hygiene & Safety. Threshold rules are ported verbatim from upstream
(`LEVEL_REQUIREMENTS` in `src/score.ts`).

## Building

Run `nx build harness-audit` to build the library.

## Running unit tests

Run `nx test harness-audit` to execute the unit tests via [Vitest](https://vitest.dev/), including
the fixture-parity suite (`src/parity.spec.ts`) that proves the port scores upstream's own
`level-0`..`level-4` graduated fixtures at the matching maturity level.
