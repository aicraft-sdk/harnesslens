# Contributing

`harnesslens` is a standalone, publishable npm package.

## Dev setup

```bash
# Node 22.14.0 required
nvm use 22.14.0

npm install
```

## Commands

```bash
npm run build            # compile via tsc, copy assets, verify dist
npm test                 # run the Vitest suite
npm run typecheck        # tsc --noEmit against tsconfig.json
npm run typecheck-spec   # tsc --noEmit against tsconfig.spec.json
```

## TDD expectation

This codebase follows RED → GREEN → REFACTOR: write a failing test first, watch it fail for
the right reason, then write the minimal code to make it pass. See the fixture-parity suite
(`src/parity.spec.ts`) for an example of pinning behavior against known-good inputs — any
change to scoring semantics should keep those fixtures landing on their expected level.

## Adding a custom check or pack

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#the-extension-model) for the full extension model.
Minimal example:

```ts
import { defineCheck, definePack } from '@ai-craft/harnesslens';

const myCheck = defineCheck({
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

export default definePack({ id: 'my-company', checks: [myCheck] });
```

If you're adding a check to one of the two built-in packs (`core` or `ai-craft`) rather than
authoring an external pack, add it to the relevant file under `src/packs/core/` or
`src/packs/ai-craft/` and export it from that pack's checks array — write the check's
`*.spec.ts` test first (RED), confirm it fails for the right reason, then implement.

## PR expectations

- `npm test` and `npm run build` pass (exit 0), with no drop in the existing test count.
- `npm run typecheck-spec` passes.
- Determinism is preserved: the same repo input must always produce the same `Report` output
  — no `Date.now()`, random ids, or unstable key/array ordering in scoring or aggregation
  code (see `src/multi-repo.ts` for the standard this is held to).
- No network calls, no LLM calls, no filesystem writes outside of an explicit, opt-in output
  path the caller requested (e.g. the CLI's `--badge <path>`) — see
  [`ARCHITECTURE.md`](./ARCHITECTURE.md#determinismsafety-guarantees).
