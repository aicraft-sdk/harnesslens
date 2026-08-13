# Live Hosted Backend — Execution Plan

> **For Claude:** REQUIRED: Follow this plan phase-by-phase, task-by-task, using TDD (RED then
> GREEN, then commit). Do not skip the RED step — every task's failing-test step must actually be
> run and observed to fail before the implementation is written.
> **Design:** `docs/plans/2026-08-13-live-hosted-backend-design.md` (approved purpose, users,
> approach, architecture shape, components, data flow, error-handling philosophy).
> **Decision RFC (approved):** `docs/plans/2026-08-13-live-hosted-backend-plan.md` (approved stack:
> NestJS + PostgreSQL + TypeORM + Ed25519; full rationale, Data Model Sketch, Security/Trust-
> Boundary Mapping, Risks). This execution plan is the "dedicated execution_plan with full TDD task
> breakdown" that RFC's own Post-Approval Roadmap section explicitly called for after approval —
> the RFC's Phase 0-4 sketch is expanded here into concrete, buildable phases. **The architecture
> and stack are settled and must not be re-litigated during BUILD.** Any genuine technical blocker
> discovered in the approved stack must be raised as a stop-and-clarify moment, not silently routed
> around with a different technology.

**Goal:** Build item 1 of `ARCHITECTURE.md`'s "Future direction" list — a live, multi-tenant,
containerized scoring API + Postgres backend with two trust tiers (basic/self-reported, verified/
Ed25519-signed) and two visibility tiers (public/private) — as a new, fully additive `backend/`
package that never modifies `src/`, `action/`, or `leaderboard/`.

**Architecture:** A standalone NestJS application (`backend/`) with four TypeORM-mapped tables
(`accounts`, `signing_keys`, `repos`, `submissions`, plus an audit table `rejected_submissions`),
packaged as Docker containers with a docker-compose-based local dev environment. Submission API
(write path) and Query API (read path) share one NestJS app/module tree for v1 — split into
separate deployable services is an explicit non-goal here (see Recommended Defaults).

**Tech Stack:** NestJS, PostgreSQL 16, TypeORM (`@nestjs/typeorm`), `class-validator` /
`class-transformer` DTOs, `@nestjs/throttler` (rate limiting), Node's built-in `node:crypto`
Ed25519 support (no third-party signing library — keeps the dependency surface minimal per the
RFC's Constraints), Vitest (repo-wide test-runner convention) + `@nestjs/testing` + `supertest` for
HTTP-level tests, `@testcontainers/postgresql` for integration/e2e tests against a real ephemeral
Postgres. Docker + docker-compose for packaging (hosting provider still deferred, unchanged from
the RFC).

**Prerequisites:** Approved RFC (`docs/plans/2026-08-13-live-hosted-backend-plan.md`) and approved
design (`docs/plans/2026-08-13-live-hosted-backend-design.md`). Local machine has Docker available
(verified: `docker --version` → Docker 28.2.2 in this environment) and Node `>=22.0.0` (verified:
`node --version` → v22.22.0). No existing `backend/`, `service/`, or `api/` directory exists in this
repo today (verified via repo listing) — this plan creates that directory from scratch.

**Durable Decisions** (foundational, apply across all phases below — do not re-derive per phase):

1. **New sibling package `backend/`**, following the `leaderboard/` precedent (own `package.json`,
   own `tsconfig*.json`, own `node_modules`, not wired into any root `workspaces` field — the root
   `package.json` has no `workspaces` key today, and `leaderboard/` already isn't wired into one
   either, so `backend/` follows the same unlinked-sibling-package pattern, not a new convention).
   **Root `package.json`, `src/`, `action/`, and `leaderboard/` are never modified by this plan.**
2. **Module system: CommonJS, not ESM**, for `backend/` specifically — a deliberate, documented
   divergence from `harnesslens`'/`harnesslens-leaderboard`'s `"type": "module"` convention.
   Rationale: NestJS's DI container depends on `emitDecoratorMetadata` + legacy
   `experimentalDecorators`, which is the framework's own best-supported, most-documented mode
   under CommonJS; `backend/` has zero cross-imports with `src/` or `leaderboard/` (fully additive,
   isolated dependency graph), so there is no module-system interop reason to force ESM here. See
   Codebase Reality Check for the concrete tsconfig conflict this avoids.
3. **`backend/tsconfig.json` does NOT extend root `tsconfig.base.json`.** The root base config's
   `useDefineForClassFields: true` conflicts with TypeORM's decorator-based `@Column()` property
   initialization under legacy decorators (a documented TypeORM/NestJS gotcha — decorated class
   fields must NOT use ECMAScript `define` semantics or the decorator's own property definition is
   overwritten by the class field initializer). `backend/`'s tsconfig is self-contained, based on
   NestJS's own standard starter tsconfig, keeping `strict: true` for consistency where it doesn't
   conflict.
4. **Test runner: Vitest**, not NestJS's default Jest — for repo-wide consistency with `harnesslens`
   and `harnesslens-leaderboard` (both already use Vitest). `@nestjs/testing`'s `Test.createTestingModule()` API is test-runner-agnostic, so this substitution is mechanical, not
   a fight against the framework.
5. **Final schema (not "illustrative" anymore — finalized here, per the RFC's own note that the
   Data Model Sketch would be "finalized at execution-plan time")**: five tables —
   `accounts`, `signing_keys`, `repos`, `submissions`, `rejected_submissions` (audit log, adopted
   from the RFC's "optional" note — included in v1 to fully satisfy the "reject with a reason,
   never silently drop" mirrored discipline). Exact columns are specified in Phase 0.
6. **Account/repo auto-provisioning for basic-tier submissions**: a basic-tier (unsigned) submission
   with a never-seen-before `repoId` auto-creates an `accounts` row (`org_name` = the `org` segment
   of `repoId`) and a `repos` row (`visibility = 'public'` by default) if they don't already exist.
   This mirrors the leaderboard's existing self-reported-by-`repoId` model extended to a live write
   path — nothing before this plan required pre-registration to submit to the leaderboard, and
   basic tier deliberately keeps that same low-friction, "self-reported" trust level. **Verified**
   and **private** tiers require explicit account registration (Phase 3) because they need a
   long-lived credential (signing key / API key) to exist somewhere.
7. **Account authentication: opaque bearer API key**, not JWT/session/OAuth. Rationale: submitters
   are CI pipelines posting programmatically (per the design's Data Flow: "submitter's own CI...
   POST to Submission API"), not humans authenticating through a browser session — there is no
   login UI in scope. An account is created via `POST /accounts`, which returns a raw API key
   exactly once (only its SHA-256 hash is persisted, in `accounts.api_key_hash`), used as
   `Authorization: Bearer <key>` for all account-scoped write endpoints (signing-key registration,
   repo visibility toggling, private-tier queries). This is separate from and does not replace
   Ed25519 payload signing — the API key authenticates *the account holder managing their account*;
   the Ed25519 signature authenticates *the individual submission payload's verified-tier claim*.
8. **Tenant isolation is two independent layers** (per this repo's established two-layer trust
   pattern — see `leaderboard`'s allowlist-input + `.textContent`-only-output precedent): (a) a
   controller/guard-level check that the authenticated account owns the requested resource, and
   (b) every private-tier repository query method requires an `accountId` parameter and always
   includes it in its `WHERE` clause — there is no code path that can query private submissions
   without that filter present, so a guard bug alone cannot leak cross-tenant data. Postgres
   row-level security (RLS) was considered and explicitly deferred (see Alternatives) in favor of
   this simpler, more directly testable mechanism for v1.
9. **Ed25519 keys are exchanged as base64-encoded raw 32-byte public keys** (`signing_keys.public_key`) and base64-encoded raw 64-byte signatures. Verification uses Node's native
   `crypto.verify(null, data, keyObject, signature)` with the public key reconstructed via a JWK
   (`{ kty: 'OKP', crv: 'Ed25519', x: <base64url> }`) `KeyObject` — no third-party signing library.
10. **The canonical signing payload is always server-reconstructed, never client-supplied.** The
    server never accepts a "canonical string" as request input; it rebuilds the exact canonical JSON
    string itself from the already-validated, already-field-by-field-reconstructed submission fields
    before verifying a signature against it. This removes an entire class of canonicalization-
    mismatch trust bugs (a client cannot lie about what it "meant" to sign).

## Recommended Defaults

These were genuinely open at RFC time (the RFC explicitly deferred them to execution-plan time) but
are finalized here as part of this execution plan, and are already codified above as Durable
Decisions 6-8. Listed together here for single-lookup transparency — **these are settled defaults,
not open or pending items**, and per the Durable Decisions preamble they are not re-litigated per
phase:

- **Auto-provisioning accounts/repos on first basic-tier submission** (Durable Decision 6): a
  never-seen `repoId` auto-creates an `accounts` row and a `repos` row (`visibility: 'public'`).
  Adopted because no code path in this repo has ever required pre-registration to appear on the
  leaderboard; basic tier preserves that same low-friction default.
- **Opaque bearer API-key auth for account-scoped actions** (Durable Decision 7): chosen over
  JWT/session/OAuth because submitters are CI pipelines posting programmatically, not
  browser-authenticated humans — there is no login UI in scope.
- **Mandatory-`WHERE`-clause repository scoping over Postgres RLS for tenant isolation** (Durable
  Decision 8): chosen for connection-pooling correctness (RLS's `SET LOCAL app.current_account_id`
  only works reliably with an explicit per-request `QueryRunner`/transaction wrapper) and direct
  unit-testability (Task 4.2's structural test) over RLS's DB-enforced guarantee. Full tradeoff
  discussion in Alternatives.
- **Submission API and Query API share one NestJS module tree for v1** (referenced in Architecture
  and Out Of Scope, not its own numbered Durable Decision): splitting into two deployable services
  is deferred until load characteristics diverge; nothing in the module structure below prevents a
  later split.
- **Rate-limit threshold defaults to `SUBMIT_RATE_LIMIT_PER_MIN=30`, env-overridable** (Phase 1,
  Task 1.5): a starting default, not a tuned production value — adjust via the
  `SUBMIT_RATE_LIMIT_PER_MIN` env var once real traffic patterns are known.

---

## Context References

### Patterns to Follow (existing repo conventions this plan re-implements at the HTTP layer)
- `leaderboard/src/parse-submission.ts` (full file, 124 lines) — allowlist parsing: exactly 7
  named fields read and rebuilt into a **new** object, never a spread of raw parsed JSON;
  `__proto__`/`constructor`/`prototype` key rejection wherever a submission-controlled string
  becomes an object key (lines 53, 81); fail-closed on `dimensions[]` malformed entries but
  fail-open (drop-the-one-entry) on `frameworkMapping` malformed entries (lines 74-78, documented
  rationale in the comment) — **carry this exact fail-closed/fail-open split into the backend's DTO
  validation**, not just the dangerous-key rule.
- `leaderboard/src/build-leaderboard.ts` (lines 1-59) — pure aggregation pattern: dedup by
  `repoId` keeping newest `scannedAt`, `skipped: SkippedEntry[]` result shape (never silently
  drop, always a `{file, reason}` record) — the Query API's "latest per repo" logic and the
  Submission API's rejection-with-reason logic both mirror this shape.
- `leaderboard/package.json` — sibling-package precedent (own `package.json`, own `tsconfig*`,
  `"dependencies": {}` bias, `pretest`/`typecheck` script naming convention).

### Configuration Files
- `/Users/david.gracia/Desktop/projects/own/harnesslens/tsconfig.base.json` — root base config;
  **`backend/tsconfig.json` deliberately does not extend this** (see Durable Decision 3).
- `/Users/david.gracia/Desktop/projects/own/harnesslens/package.json` — no `workspaces` field;
  `backend/` stays unlinked, same as `leaderboard/` today.

### Related Documentation
- `docs/plans/2026-08-13-live-hosted-backend-design.md` — approved purpose/users/architecture.
- `docs/plans/2026-08-13-live-hosted-backend-plan.md` — approved RFC: Recommended Stack
  rationale, Data Model Sketch (illustrative baseline this plan finalizes), Security/Trust-
  Boundary Mapping table, Risks and Mitigations table, Phase Dependency Map, Phase Autonomy
  Classification (this plan's HITL phases mirror the RFC's Phase 3/Phase 4 classification).
- `leaderboard/README.md` "Usage (local)" (lines 135-150) and "Security model" (line 152+) —
  local-dev command conventions (`nvm use 22.14.0`, `npm run build`) and the two-layer security
  framing this plan's tenant-isolation design explicitly continues.
- `ARCHITECTURE.md` "Future direction" section (lines 84-124) — the roadmap item this plan builds.

---

## Codebase Reality Check

- **Verified files/surfaces:** `package.json` (root, no workspaces), `leaderboard/package.json`,
  `leaderboard/tsconfig.json`/`tsconfig.lib.json`, `tsconfig.base.json` (root),
  `leaderboard/src/parse-submission.ts` (read in full), `leaderboard/src/build-leaderboard.ts`
  (read in full), `leaderboard/README.md` (Usage/local + Security model sections),
  `ARCHITECTURE.md` (Future direction section), repo directory listing (confirmed no `backend/`,
  `service/`, `api/`, `Dockerfile`, or `docker-compose.yml` exists anywhere today), local
  environment (`node --version` → v22.22.0, `docker --version` → 28.2.2, both available).
- **Existing patterns/constraints confirmed:** zero-runtime-dependency convention in both existing
  packages (`"dependencies": {}`); ESM (`"type": "module"`) + `NodeNext` module resolution in both;
  no ESLint config anywhere in the repo (only `tsc --noEmit` typecheck scripts — this plan follows
  that same lint-free-but-typechecked convention rather than introducing new lint tooling); no
  `.github/workflows/*.yml` currently present at the repo root (CI wiring for `backend/` is
  explicitly out of scope for this plan — see Out Of Scope).
- **Pressure points / contradictions:**
  1. **`useDefineForClassFields: true` (root `tsconfig.base.json`) is incompatible with
     TypeORM's decorator-based entity columns** under NestJS's legacy-decorator mode. If
     `backend/tsconfig.json` extended the root base config unmodified, `@Column()`-decorated class
     fields would silently break (the class field initializer would overwrite the decorator's
     property definition before TypeORM's metadata reflection runs). Resolved via Durable
     Decision 3 — `backend/` gets its own, non-extending tsconfig.
  2. **ESM vs. NestJS's decorator/DI tooling.** NestJS's most mature, most-documented mode is
     CommonJS + `experimentalDecorators`. Forcing ESM here (to match `src/`/`leaderboard/`'s
     `"type": "module"`) would fight the framework's own idioms for no interop benefit, since
     `backend/` never imports from or is imported by `src/`/`leaderboard/`. Resolved via Durable
     Decision 2.
  3. **No pre-existing HTTP-layer validation code to reuse.** `parseSubmission` validates
     filesystem-sourced JSON, not HTTP request bodies — this plan must re-derive the same
     discipline (allowlist, field-by-field rebuild, dangerous-key rejection) as NestJS DTOs +
     `class-validator`, not import or wrap the existing function (also blocked by the CommonJS/ESM
     split above, and by the Constraints section's additive-only rule).

## Plan-vs-Code Gaps

| Current code/behavior | Planned change | Gap/risk | Plan response |
|---|---|---|---|
| No live write path anywhere in this repo | New unauthenticated-by-default (basic-tier) `POST /submissions` | Removes the PR-review trust gate the leaderboard relies on | Rate limiting (`@nestjs/throttler`) + allowlist DTO validation + visible "self-reported"/`verified: false` field stand in for human review (Phase 1) |
| Both existing packages: `"dependencies": {}` | `backend/package.json` needs `@nestjs/*`, `typeorm`, `pg`, `class-validator`, etc. | Breaks the zero-dependency precedent | Explicitly accepted per the RFC's Constraints; this plan keeps the dependency list to the minimum NestJS + TypeORM + Postgres require, and deliberately avoids adding a signing library (native `node:crypto` instead) and avoids a lint-tooling addition, staying as close to minimal as a NestJS app can be |
| No container tooling exists | New `Dockerfile` + `docker-compose.yml` | New operational surface, no in-repo precedent | Phase 0 designs the dev shape; Phase 5 hardens it into a production-shaped multi-stage build, both validated by concrete smoke-test commands (see those phases) |
| `parseSubmission`'s allowlist logic only runs against filesystem-sourced, PR-reviewed JSON | Same discipline re-implemented against live HTTP bodies | No existing HTTP-layer code to reuse | Phase 1 re-derives it explicitly as NestJS DTOs + a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` + field-by-field service-layer reconstruction — two independent layers, matching this repo's established pattern |
| No auth/identity concept exists anywhere in this repo today | New `accounts`/API-key/Ed25519 identity model | Genuinely new trust surface with no in-repo precedent to reconcile against | Phase 3/4 are classified HITL (human_verify) per the RFC's own Phase Autonomy Classification — a human checks the security-critical layers before those phases are marked done, not just green tests |
| Repo-wide Vitest convention (`src/`, `leaderboard/`) never exercises constructor-based DI, so no existing config proves esbuild's transform is DI-safe | NestJS's `@nestjs/testing` + decorator-based DI throughout `backend/` | Vitest's default esbuild transform silently drops `emitDecoratorMetadata`, breaking constructor injection for nearly every provider from Task 1.2 onward if unaddressed | Phase 0 Task 0.2 wires `unplugin-swc` into both `vitest.config.ts`/`vitest.integration.config.ts` with a RED/GREEN `di-probe.spec.ts` regression guard, before any real provider is written |

## Assumption Ledger

- **Proven by code:** exact shape/behavior of `parseSubmission` and `buildLeaderboard` (cited
  above); zero-`workspaces` root `package.json`; zero runtime deps in both existing packages;
  `useDefineForClassFields: true` in root `tsconfig.base.json`; no ESLint config anywhere; Docker
  and Node ≥22 available in this environment; Vitest's default transform is esbuild via Vite, which
  does not emit `emitDecoratorMetadata`'s `design:paramtypes` output required by NestJS's
  reflection-based DI — demonstrated concretely by Phase 0 Task 0.2's RED step against this
  codebase's own DI graph, not asserted from general knowledge alone.
- **Inferred:** that `backend/` (not `service/` or `api/`) is the right directory name — follows
  the RFC's own inferred naming (`docs/plans/2026-08-13-live-hosted-backend-plan.md` line 90); that
  CommonJS + a non-extending tsconfig is the right resolution to the decorator/ESM friction
  described above, rather than fighting NestJS toward ESM.
- **Settled as Durable Decisions, not open questions:** auto-provisioning accounts/repos on first
  basic-tier submission (Durable Decision 6); opaque bearer API-key auth for account-scoped actions
  (Durable Decision 7); mandatory-`WHERE`-clause repository scoping over Postgres RLS for tenant
  isolation (Durable Decision 8); exact rate-limit threshold (Phase 1, defaulted and
  env-overridable). These were genuinely open at RFC time (the RFC deferred them to execution-plan
  time) but are finalized as of this plan — see the Recommended Defaults section above for the
  single-lookup summary and rationale. Per the Durable Decisions preamble, they are not
  re-litigated per phase.

---

## Out Of Scope

- Items 2-4 of `ARCHITECTURE.md`'s "Future direction" list.
- Choosing or configuring a hosting/cloud provider (still explicitly deferred).
- CI workflow wiring (`.github/workflows/*.yml`) for `backend/` — a fast-follow once a hosting
  target exists; premature to wire CI for a service with no deployment target yet.
- Embeddable live badge rendering (fast-follow per the RFC, reads off the Query API once it
  exists).
- A client SDK for submitters (the canonical-payload contract is documented precisely enough in
  this plan for a future SDK to implement against, but building one is not part of this plan).
- Splitting Submission API and Query API into separately deployable services (both live in one
  NestJS app/module tree for v1 — a real option if load characteristics later diverge, not needed
  now; this keeps `docker-compose.yml` to one `api` service instead of two, and nothing in the
  module structure below prevents a later split).
- Postgres row-level security (considered for tenant isolation, deferred — see Durable Decision 8
  and Alternatives).

---

## Live Verification Strategy

- **Manifest:** `backend/test/live/manifest.json` (created in Phase 0, Task 0.6) — a small
  project-owned JSON file (not craftflow's own internal Python harness runner, which is not
  vendored into this repo) recording: the docker-compose file path, the health-check URL, and the
  ordered list of proof-scenario npm scripts below. This keeps the live lane self-documenting and
  re-runnable without depending on tooling external to this repo.
- **Environment ownership:** first-party — the NestJS API container and the Postgres container are
  both fully first-party and run locally via `docker compose`; there are no third-party network
  dependencies anywhere in this backend (no external auth provider, no external payment/email
  service). Nothing is stubbed at a boundary because there is no external boundary in v1.
- **Setup:** `cd backend && npm ci && docker compose build`
- **Reset/Seed:** `docker compose down -v && docker compose up -d --wait` (fresh Postgres volume
  each run; the one-shot `migrate` compose service applies all migrations before `api` starts —
  no seed data beyond the schema itself; each proof scenario creates its own fixtures via the API)
- **Health:** `curl -sf http://localhost:3000/health` → expect `{"status":"ok"}`
- **Proof scenarios** (each maps to a named integration/e2e test file introduced in the phase
  noted; each is independently re-runnable against a freshly reset environment):
  - `Golden path: basic-tier submission is created and immediately queryable` (Phase 1 + 2)
  - `Negative path: malformed submission is rejected with a structured reason, not silently
    dropped` (Phase 1)
  - `Negative path: submission containing a "__proto__" dimension id is rejected` (Phase 1)
  - `Golden path: signed submission from a registered key is marked verified` (Phase 3)
  - `Negative path: submission with an invalid signature is rejected outright, never marked
    verified: false and silently accepted as if unsigned` (Phase 3)
  - `Golden path: account owner can toggle a repo to private and query its own private history`
    (Phase 4)
  - `Negative path: a different account cannot read another account's private repo history (404,
    not 403, and not visible in the public listing)` (Phase 4)
  - `Recovery path: rate-limited submitter receives 429 and can resubmit after the window resets`
    (Phase 1)
- **Stress scenarios:** `Submission burst stays within the configured rate-limit threshold and does
  not corrupt data under concurrent writes to the same repoId` — run via
  `npm run test:stress -- --scenario submission-burst` (Phase 1, optional/deferred exact profile —
  see Risks; not a v1 blocking requirement, but the npm script scaffold is created in Phase 1 so
  it's not a hollow promise).
- **Cleanup:** `docker compose down -v --remove-orphans`

---

## Phase Dependency Map

- **Phase 0** (Scaffold + schema + dev env): no dependencies; creates the `backend/` package, all
  five tables, and a running local Docker/Postgres environment; enables every later phase (all need
  a running DB).
- **Phase 1** (Submission API, basic tier): depends on Phase 0's schema/entities; creates the first
  live write path and the `rejected_submissions` audit pattern; enables Phase 2 (something to
  query) and Phase 3 (adds signature verification onto this same endpoint).
- **Phase 2** (Query API, public tier): depends on Phase 1 (needs a persisted submission shape);
  creates the first live read path; enables Phase 4's authenticated/historical extensions.
- **Phase 3** (Verified tier): depends on Phase 1 (same endpoint, additive) and Phase 0's
  `accounts`/`signing_keys` tables; enables the `verified` badge Phase 2/4 already surface (no
  Query API changes needed — the field already exists on the entity from Phase 0).
- **Phase 4** (Private tier + authenticated queries): depends on Phase 2 (extends the same
  endpoints) and Phase 3 (reuses the account/API-key model Phase 3 introduces); creates the second
  tenant-isolation defense layer.
- **Phase 5** (Container hardening + full-stack smoke test): depends on all of Phase 0-4 existing;
  creates the production-shaped multi-stage `Dockerfile` and the live-verification manifest's full
  proof-scenario run.

---

## Phase 0: Backend Scaffold, Schema & Local Dev Environment

> **Exit Criteria:** `cd backend && docker compose up -d --wait` produces a running API container
> connected to a running Postgres container with all five tables migrated; `curl -sf
> http://localhost:3000/health` returns `{"status":"ok"}`; `npm test` (unit) and `npm run
> test:integration` (schema-verification, against a Testcontainers Postgres) both pass — including
> Task 0.2's `di-probe.spec.ts` under both configs, proving constructor-injected DI resolves before
> any real provider is written.

**Strategy:** `incremental` — schema and app bootstrap must exist before any endpoint can be built;
each task layers directly on the previous one.

### Task 0.1: Package scaffold

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/tsconfig.build.json`,
  `backend/nest-cli.json`, `backend/.gitignore`, `backend/.env.example`

No test for this task — pure scaffolding (no behavior to assert yet). Contents:

`backend/package.json` (excerpt — exact dependency versions resolved at implementation time
against currently-published majors: NestJS 10.x, TypeORM 0.3.x):
```json
{
  "name": "@ai-craft/harnesslens-backend",
  "version": "0.0.1",
  "private": true,
  "description": "Live, multi-tenant scoring API + Postgres backend for harnesslens (item 1 of ARCHITECTURE.md Future direction). Not published.",
  "engines": { "node": ">=22.0.0" },
  "license": "MIT",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:stress": "node scripts/stress-scenario.mjs",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "migration:generate": "typeorm-ts-node-commonjs migration:generate -d src/data-source.ts",
    "migration:run": "typeorm-ts-node-commonjs migration:run -d src/data-source.ts"
  }
}
```
`backend/tsconfig.json` (does NOT extend `../tsconfig.base.json` — see Durable Decision 3):
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "baseUrl": "./"
  }
}
```

**Verification:** `cd backend && npm install && npm run typecheck` → expect exit 0 with no source
files yet present (empty compile is a no-op success).

**Commit:** `git add backend/package.json backend/tsconfig*.json backend/nest-cli.json
backend/.gitignore backend/.env.example && git commit -m "chore(backend): scaffold backend package"`

### Task 0.2: Vitest configuration with SWC transform (constructor-injection DI proof)

**Why this task exists (do not skip or treat as boilerplate):** NestJS's DI container resolves
constructor parameters via TypeScript's `emitDecoratorMetadata` output (`design:paramtypes`
reflection metadata). Vitest's default transform is esbuild via Vite, and esbuild does **not**
emit that metadata. Every provider in this plan with a constructor-injected dependency —
`SubmissionsController` injecting `SubmissionsService`/`ReposService`, any `@InjectRepository()`
TypeORM repository, `ApiKeyGuard`, etc. — would fail to resolve under
`Test.createTestingModule().compile()` from Task 1.2 onward if this is skipped. This task must be
done, and proven with a real RED/GREEN cycle, before any provider with a constructor dependency is
written.

**Files:**
- Create: `backend/vitest.config.ts`, `backend/vitest.integration.config.ts`, `backend/.swcrc`,
  `backend/src/common/di-probe.spec.ts`
- Modify: `backend/package.json` (add `unplugin-swc` and `@swc/core` to `devDependencies`)

**Step 1 — RED:** first write both Vitest configs using only the default esbuild transform (no SWC
plugin yet), and write a DI-resolution probe test using two throwaway `@Injectable()` classes with
constructor injection between them — the same pattern every real provider in this plan will use.

```ts
// backend/vitest.config.ts (RED version — default esbuild transform, no SWC plugin)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
});
```

```ts
// backend/vitest.integration.config.ts (RED version — default esbuild transform, no SWC plugin)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e-spec.ts', 'test/integration/**/*.int-spec.ts'],
    environment: 'node',
    testTimeout: 30_000, // Testcontainers/Postgres startup needs headroom
  },
});
```

```ts
// backend/src/common/di-probe.spec.ts — kept permanently in the suite after this task (not
// deleted once GREEN): the cheapest possible regression guard against a future dependency bump
// or config edit silently reverting to the esbuild default and breaking every constructor-injected
// provider from Task 1.2 onward.
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, it, expect } from 'vitest';

@Injectable()
class DiProbeDependency {
  readonly value = 'dependency-resolved';
}

@Injectable()
class DiProbeConsumer {
  constructor(public readonly dependency: DiProbeDependency) {}
}

describe('Vitest transform emits constructor-injection metadata for Nest DI', () => {
  it('resolves a constructor-injected provider via Test.createTestingModule().compile()', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [DiProbeDependency, DiProbeConsumer],
    }).compile();
    const consumer = moduleRef.get(DiProbeConsumer);
    expect(consumer.dependency).toBeInstanceOf(DiProbeDependency);
    expect(consumer.dependency.value).toBe('dependency-resolved');
  });
});
```

Run: `cd backend && npx vitest run --config vitest.config.ts src/common/di-probe.spec.ts`
Expected: FAIL — Nest throws `UnknownDependenciesException: Nest can't resolve dependencies of the
DiProbeConsumer (?). Please make sure that the argument DiProbeDependency at index [0] is available
...`, because esbuild's transform strips `experimentalDecorators`/`emitDecoratorMetadata` output —
`design:paramtypes` is never emitted, so Nest's reflection-based DI has nothing to resolve
`DiProbeConsumer`'s constructor parameter type from. This is the exact failure mode that would
otherwise silently break nearly every provider from Task 1.2 onward.

**Step 2 — GREEN:** install `unplugin-swc` and `@swc/core` as dev dependencies, then wire the SWC
transform into both configs.

```ts
// backend/vitest.config.ts (GREEN version)
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
});
```

```ts
// backend/vitest.integration.config.ts (GREEN version)
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/e2e/**/*.e2e-spec.ts', 'test/integration/**/*.int-spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
```

`backend/.swcrc` — pinned explicitly so the transform's decorator config cannot silently drift if
`tsconfig.json` is later edited (unplugin-swc otherwise reads `experimentalDecorators`/
`emitDecoratorMetadata` from `tsconfig.json` by default):
```json
{
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "target": "es2022"
  },
  "module": { "type": "es6" }
}
```

Run: `npx vitest run --config vitest.config.ts src/common/di-probe.spec.ts`
Expected: PASS — `consumer.dependency` resolves to a real `DiProbeDependency` instance.

Also run the same probe under the integration config, to prove both configs share the working
transform, not just the unit one:
Run: `npx vitest run --config vitest.integration.config.ts src/common/di-probe.spec.ts`
Expected: PASS.

**Commit:** `git add backend/vitest.config.ts backend/vitest.integration.config.ts backend/.swcrc
backend/package.json backend/src/common/di-probe.spec.ts && git commit -m "test(backend): wire SWC transform into Vitest configs, prove Nest DI constructor injection resolves"`

### Task 0.3: NestJS bootstrap + health endpoint (RED/GREEN)

**Files:**
- Create: `backend/src/main.ts`, `backend/src/app.module.ts`,
  `backend/src/health/health.controller.ts`, `backend/src/health/health.controller.spec.ts`

**Step 1 — RED:** write the failing unit test.
```ts
// backend/src/health/health.controller.spec.ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns { status: "ok" }', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    const controller = moduleRef.get(HealthController);
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```
Run: `cd backend && npx vitest run src/health/health.controller.spec.ts`
Expected: FAIL — `Cannot find module './health.controller'`.

**Step 2 — GREEN:** implement.
```ts
// backend/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```
Wire `HealthController` into `app.module.ts`'s `controllers` array; `main.ts` calls
`NestFactory.create(AppModule)`, `app.useGlobalPipes(new ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true }))` (global from day one — every later DTO relies on this), listens on
`process.env.PORT ?? 3000`.

Run: `npx vitest run src/health/health.controller.spec.ts` → Expected: PASS.

**Step 3 — e2e confirmation:**
```ts
// backend/test/e2e/health.e2e-spec.ts
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

it('GET /health -> 200 { status: "ok" }', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  await app.close();
});
```
Run: `npx vitest run --config vitest.integration.config.ts test/e2e/health.e2e-spec.ts` → Expected:
PASS (no DB needed yet since `AppModule` doesn't import `TypeOrmModule` until Task 0.4).

**Commit:** `git add backend/src/main.ts backend/src/app.module.ts backend/src/health
backend/test/e2e/health.e2e-spec.ts && git commit -m "feat(backend): add NestJS bootstrap and health endpoint"`

### Task 0.4: TypeORM entities (five tables)

**Files:**
- Create: `backend/src/accounts/entities/account.entity.ts`,
  `backend/src/signing-keys/entities/signing-key.entity.ts`,
  `backend/src/repos/entities/repo.entity.ts`,
  `backend/src/submissions/entities/submission.entity.ts`,
  `backend/src/submissions/entities/rejected-submission.entity.ts`,
  `backend/src/data-source.ts`

Final column set (binding for this plan — not illustrative):

| Table | Columns |
|---|---|
| `accounts` | `id` uuid PK (`default: () => 'gen_random_uuid()'`), `org_name` varchar UNIQUE NOT NULL, `api_key_hash` varchar UNIQUE NOT NULL, `created_at` timestamptz default now() |
| `signing_keys` | `id` uuid PK, `account_id` uuid FK→accounts(id) NOT NULL, `public_key` varchar NOT NULL (base64, raw 32-byte Ed25519), `key_id` varchar UNIQUE NOT NULL, `created_at` timestamptz default now(), `revoked_at` timestamptz NULL |
| `repos` | `id` uuid PK, `account_id` uuid FK→accounts(id) NOT NULL, `repo_id` varchar UNIQUE NOT NULL (`"org/repo"` shape), `visibility` varchar(7) NOT NULL CHECK (`visibility` IN ('public','private')) default `'public'`, `created_at` timestamptz default now() |
| `submissions` | `id` uuid PK, `repo_id` uuid FK→repos(id) NOT NULL, `score` numeric(5,2) NOT NULL, `level` jsonb NOT NULL, `dimensions` jsonb NOT NULL, `framework_mapping` jsonb NOT NULL, `commit_sha` varchar(40) NOT NULL, `scanned_at` timestamptz NOT NULL, `verified` boolean NOT NULL default false, `signature` varchar NULL, `key_id` varchar NULL, `submitted_at` timestamptz default now() — **insert-only: no update/delete repository method is ever exposed on this entity** |
| `rejected_submissions` | `id` uuid PK, `payload_hash` varchar NOT NULL, `reason` varchar NOT NULL, `rejected_at` timestamptz default now() |

Indexes: `repos.repo_id` (unique, already implied by constraint), composite index on
`submissions(repo_id, scanned_at DESC)` for history queries, `accounts.api_key_hash` (unique).

**Step 1 — RED:** integration test asserting the tables don't exist yet.
```ts
// backend/test/integration/schema.int-spec.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

it('creates all five tables after running migrations', async () => {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const ds = new DataSource({ type: 'postgres', url: container.getConnectionUri(), entities: ['src/**/*.entity.ts'], migrations: ['src/migrations/*.ts'] });
  await ds.initialize();
  await ds.runMigrations();
  const tables = await ds.query(`select table_name from information_schema.tables where table_schema = 'public'`);
  const names = tables.map((t: { table_name: string }) => t.table_name).sort();
  expect(names).toEqual(['accounts', 'migrations', 'rejected_submissions', 'repos', 'signing_keys', 'submissions']);
  await ds.destroy();
  await container.stop();
});
```
Run: `npx vitest run --config vitest.integration.config.ts test/integration/schema.int-spec.ts`
Expected: FAIL — no `src/migrations/*.ts` exists yet, `ds.runMigrations()` is a no-op, table list
is empty (`['migrations']` only, or an error if entities don't exist).

**Step 2 — GREEN:** write the five entity files (per the column table above, using
`@Entity/@PrimaryGeneratedColumn/@Column/@ManyToOne/@Index/@CreateDateColumn` decorators), enable
`pgcrypto` in the migration for `gen_random_uuid()`, then generate and commit the migration:
`npm run migration:generate -- src/migrations/InitSchema`.

Run the same test again → Expected: PASS.

**Commit:** `git add backend/src/accounts backend/src/signing-keys backend/src/repos
backend/src/submissions backend/src/data-source.ts backend/src/migrations
backend/test/integration/schema.int-spec.ts && git commit -m "feat(backend): add TypeORM entities and initial migration for five tables"`

### Task 0.5: Wire `TypeOrmModule` into `AppModule`

**Files:** Modify `backend/src/app.module.ts`.

**Step 1 — RED:** extend the Task 0.3 e2e health test to also assert DB connectivity via a new
`GET /health/db` endpoint that runs `SELECT 1`.
```ts
it('GET /health/db -> 200 { status: "ok" } when DB is reachable', async () => { /* ... expect 200 */ });
```
Run against a Testcontainers Postgres → Expected: FAIL (`/health/db` doesn't exist).

**Step 2 — GREEN:** add `TypeOrmModule.forRootAsync(...)` reading `DATABASE_URL` from env, add a
`GET /health/db` handler in `HealthController` injecting the `DataSource` and running `SELECT 1`.

Run → Expected: PASS.

**Commit:** `git add backend/src/app.module.ts backend/src/health && git commit -m "feat(backend): wire TypeORM DataSource into AppModule with DB health check"`

### Task 0.6: Docker + docker-compose dev environment + live-verification manifest

**Files:**
- Create: `backend/Dockerfile` (single named stage `FROM node:22-alpine AS dev`, `npm ci`,
  `CMD ["npm", "run", "start:dev"]` — named `dev` explicitly from the start, so Phase 5's later
  multi-stage restructuring appends new stages after it rather than retrofitting a name onto an
  unnamed stage), `backend/docker-compose.yml` (`db`: `postgres:16-alpine` with a healthcheck
  `pg_isready`; `migrate`: one-shot, `depends_on: db (service_healthy)`, runs `npm run
  migration:run`, exits; `api`: `depends_on: migrate (service_completed_successfully)`, builds from
  `Dockerfile` with an **explicit `build.target: dev` pin** — without this pin, `docker compose
  build`/`up` defaults to the *last* stage defined in the Dockerfile, which would silently swap
  this dev/watch-mode container for Phase 5's later production `runtime` stage the moment that
  stage is appended; pinning `target: dev` now means Phase 5 never has to retrofit this — mounts
  `./src` for watch mode, exposes `3000:3000`), `backend/.dockerignore`,
  `backend/test/live/manifest.json` (per the Live Verification Strategy section above)

No unit test for compose wiring itself — verified via the smoke-test acceptance check below
(infra-only task, matches the planning-patterns exception for infrastructure setup).

**Verification (acceptance check, not a unit test):**
```bash
cd backend
docker compose up -d --wait
curl -sf http://localhost:3000/health/db
# Expected: {"status":"ok"}
docker compose down -v
```

**Commit:** `git add backend/Dockerfile backend/docker-compose.yml backend/.dockerignore
backend/test/live/manifest.json && git commit -m "feat(backend): add docker-compose dev environment"`

---

## Phase 1: Submission API — Basic Tier (Unsigned)

> **Exit Criteria:** A valid basic-tier `POST /submissions` persists a row and returns 201; a
> submission missing a required field, containing an extra field, or containing a `"__proto__"`
> dimension id is rejected with a structured 400 reason (and an audit row in
> `rejected_submissions`), never silently dropped or 200'd. Both the DTO/`ValidationPipe` layer and
> the service-layer field-by-field reconstruction are present (two independent layers — do not
> consider this phase done if only one exists). Rate limiting returns 429 past the configured
> threshold.

**Strategy:** `incremental` — DTOs → controller → service → rate limiting, each layering onto the
last; step order matters because later tasks depend on the shapes established earlier.

### Task 1.1: `CreateSubmissionDto` with allowlist validation (RED/GREEN)

**Files:**
- Create: `backend/src/submissions/dto/create-submission.dto.ts`,
  `backend/src/submissions/dto/create-submission.dto.spec.ts`,
  `backend/src/common/dangerous-keys.ts`

`backend/src/common/dangerous-keys.ts` (copied constant, not imported from `leaderboard/` — see
Risks for why cross-package import is deliberately avoided):
```ts
export const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;
export function isDangerousKey(key: string): boolean {
  return (DANGEROUS_KEYS as readonly string[]).includes(key);
}
```

**Step 1 — RED:**
```ts
// create-submission.dto.spec.ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSubmissionDto } from './create-submission.dto';

const validPayload = {
  repoId: 'acme/widgets', score: 82.5, level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: '2026-08-13T00:00:00.000Z',
};

it('accepts a valid basic-tier payload', async () => {
  const dto = plainToInstance(CreateSubmissionDto, validPayload);
  expect(await validate(dto)).toHaveLength(0);
});

it('rejects an extra top-level field', async () => {
  const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, extra: 'nope' }, { excludeExtraneousValues: false });
  // exercised at the ValidationPipe level in the e2e test below (forbidNonWhitelisted), this
  // unit test asserts the DTO's own field surface has no `extra` property to accept
  expect(Object.keys(dto)).not.toContain('extra');
});

it('rejects a dimension with id "__proto__"', async () => {
  const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, dimensions: [{ ...validPayload.dimensions[0], id: '__proto__' }] });
  const errors = await validate(dto);
  expect(errors.length).toBeGreaterThan(0);
});
```
Run: `npx vitest run src/submissions/dto/create-submission.dto.spec.ts`
Expected: FAIL — `Cannot find module './create-submission.dto'`.

**Step 2 — GREEN:**
```ts
// create-submission.dto.ts
import { IsArray, IsISO8601, IsNumber, IsObject, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const REPO_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const SAFE_ID_RE = /^(?!__proto__$|constructor$|prototype$).+$/;

class LevelDto {
  @IsNumber() index!: number;
  @IsString() name!: string;
}
class DimensionDto {
  @IsString() @Matches(SAFE_ID_RE) id!: string;
  @IsString() title!: string;
  @IsNumber() earned!: number;
  @IsNumber() max!: number;
  @IsNumber() percent!: number;
}
export class CreateSubmissionDto {
  @Matches(REPO_ID_RE) repoId!: string;
  @IsNumber() score!: number;
  @ValidateNested() @Type(() => LevelDto) level!: LevelDto;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DimensionDto) dimensions!: DimensionDto[];
  @IsObject() frameworkMapping!: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  @Matches(SHA_RE) commitSha!: string;
  @IsISO8601() scannedAt!: string;
  keyId?: string;      // present only for verified-tier submissions (Phase 3)
  signature?: string;  // present only for verified-tier submissions (Phase 3)
}
```
Note: `frameworkMapping` is intentionally typed but not deep-validated by `class-validator` here
(arbitrary-key records aren't natively supported by `@ValidateNested`) — the service layer
(Task 1.2) re-validates it field-by-field, matching `parseSubmission`'s fail-open-per-entry rule
exactly. This is deliberate, not an oversight — documented so BUILD doesn't "fix" it by trying to
force a nested-record validator.

Run → Expected: PASS.

**Commit:** `git add backend/src/submissions/dto backend/src/common/dangerous-keys.ts && git commit -m "feat(backend): add CreateSubmissionDto with allowlist field validation"`

### Task 1.2: `SubmissionsService` — field-by-field reconstruction + dangerous-key rejection (RED/GREEN)

**Files:**
- Create: `backend/src/submissions/submissions.service.ts`,
  `backend/src/submissions/submissions.service.spec.ts`

**Step 1 — RED:**
```ts
it('rejects a frameworkMapping key of "__proto__" without throwing/polluting the prototype', () => {
  const dto = { ...validDto, frameworkMapping: { __proto__: { nistFunctions: ['GOVERN'], owaspIds: [] } } };
  const result = service.buildInsertableSubmission(dto, repoUuid);
  expect(result.ok).toBe(false);
  expect((Object.prototype as any).polluted).toBeUndefined();
});

it('never spreads the raw DTO into the insert row — constructs field-by-field', () => {
  const dto = { ...validDto, maliciousExtra: 'should never appear' } as any;
  const result = service.buildInsertableSubmission(dto, repoUuid);
  expect(result.ok && (result.row as any).maliciousExtra).toBeUndefined();
});
```
Run: `npx vitest run src/submissions/submissions.service.spec.ts`
Expected: FAIL — `buildInsertableSubmission is not a function`.

**Step 2 — GREEN:** implement `buildInsertableSubmission(dto, repoId): { ok: true; row: SubmissionRow } | { ok: false; reason: string }` that:
1. Iterates `Object.entries(dto.frameworkMapping)`, using `isDangerousKey()` from Task 1.1 to
   `continue` (skip, not fail the whole submission — matching `parseSubmission`'s fail-open rule)
   past any dangerous or malformed entry.
2. Iterates `dto.dimensions`, rejecting the **whole submission** (`ok: false`) if any `id` is a
   dangerous key (fail-closed — dimensions are scored data, matching `parseSubmission`'s stricter
   rule for this field).
3. Constructs the return row by naming every field explicitly (`repoId: dto.repoId, score:
   dto.score, ...`) — never `{ ...dto }`.

Run → Expected: PASS.

**Commit:** `git add backend/src/submissions/submissions.service.ts backend/src/submissions/submissions.service.spec.ts && git commit -m "feat(backend): add field-by-field submission reconstruction with dangerous-key rejection"`

### Task 1.3: Account/repo auto-provisioning (RED/GREEN)

**Files:**
- Create: `backend/src/repos/repos.service.ts`, `backend/test/integration/repos.service.int-spec.ts`
  (integration — needs a real DB via Testcontainers, since this exercises `findOrCreate` race
  behavior against Postgres unique constraints; placed under `test/integration/` — not
  `src/repos/` — to match Task 0.4's `schema.int-spec.ts` precedent and
  `vitest.integration.config.ts`'s `include: ['test/e2e/**/*.e2e-spec.ts',
  'test/integration/**/*.int-spec.ts']` glob, which does not discover `.int-spec.ts` files placed
  under `src/`; imports the service under test via a relative path, e.g. `import { ReposService }
  from '../../src/repos/repos.service'`)

**Step 1 — RED:**
```ts
it('creates a new account + repo on first submission for an unseen repoId', async () => {
  const repo = await reposService.findOrCreateForSubmission('acme/widgets');
  expect(repo.repoId).toBe('acme/widgets');
  expect(repo.visibility).toBe('public');
  const account = await accountsRepo.findOneBy({ id: repo.accountId });
  expect(account?.orgName).toBe('acme');
});

it('reuses the existing repo row on a second submission for the same repoId', async () => {
  const first = await reposService.findOrCreateForSubmission('acme/widgets');
  const second = await reposService.findOrCreateForSubmission('acme/widgets');
  expect(second.id).toBe(first.id);
});
```
Run: `npx vitest run --config vitest.integration.config.ts test/integration/repos.service.int-spec.ts`
Expected: FAIL — `findOrCreateForSubmission is not a function`.

**Step 2 — GREEN:** implement using a Postgres `ON CONFLICT DO NOTHING` upsert for the `accounts`
row (keyed on `org_name`) followed by the same pattern for `repos` (keyed on `repo_id`), then a
`findOne` to return the resolved row — avoids a race between concurrent first-submissions for the
same never-seen repo.

Run → Expected: PASS.

**Commit:** `git add backend/src/repos/repos.service.ts backend/test/integration/repos.service.int-spec.ts && git commit -m "feat(backend): add auto-provisioning for accounts/repos on first submission"`

### Task 1.4: `POST /submissions` controller + rejected-submissions audit (RED/GREEN)

**Files:**
- Create: `backend/src/submissions/submissions.controller.ts`,
  `backend/test/e2e/submissions.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('POST /submissions with a valid basic-tier payload -> 201, persisted, verified: false', async () => {
  const res = await request(app.getHttpServer()).post('/submissions').send(validPayload).expect(201);
  expect(res.body).toMatchObject({ verified: false });
  const row = await submissionsRepo.findOneBy({ id: res.body.id });
  expect(row?.repoId).toBeDefined();
});

it('POST /submissions with an extra top-level field -> 400, nothing persisted', async () => {
  await request(app.getHttpServer()).post('/submissions').send({ ...validPayload, extra: 'x' }).expect(400);
  expect(await submissionsRepo.count()).toBe(0);
});

it('POST /submissions with malformed payload -> 400 AND a rejected_submissions audit row', async () => {
  await request(app.getHttpServer()).post('/submissions').send({ repoId: 'bad shape' }).expect(400);
  expect(await rejectedRepo.count()).toBe(1);
});
```
Run: `npx vitest run --config vitest.integration.config.ts test/e2e/submissions.e2e-spec.ts`
Expected: FAIL — no `POST /submissions` route exists (404, not 201/400).

**Step 2 — GREEN:** implement `SubmissionsController` with `@Post()` handler calling
`reposService.findOrCreateForSubmission`, then `submissionsService.buildInsertableSubmission`,
inserting via the TypeORM `submissionsRepository.insert(row)` (never `.save({...dto})`); on a
`ValidationPipe` 400 or a service-level `ok: false`, insert a `rejected_submissions` audit row
(`payload_hash` = SHA-256 of the raw body, `reason`) via a global exception filter or explicit
catch, then return the structured 400.

Run → Expected: PASS.

**Commit:** `git add backend/src/submissions/submissions.controller.ts backend/test/e2e/submissions.e2e-spec.ts && git commit -m "feat(backend): add POST /submissions endpoint with rejection audit logging"`

### Task 1.5: Rate limiting (RED/GREEN)

**Files:**
- Modify: `backend/src/app.module.ts` (register `ThrottlerModule`), `backend/src/submissions/submissions.controller.ts` (`@Throttle` decorator)
- Create: `backend/test/e2e/submissions-rate-limit.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('returns 429 after exceeding SUBMIT_RATE_LIMIT_PER_MIN requests from one IP', async () => {
  const limit = Number(process.env.SUBMIT_RATE_LIMIT_PER_MIN ?? 30);
  for (let i = 0; i < limit; i++) await request(app.getHttpServer()).post('/submissions').send(validPayload);
  await request(app.getHttpServer()).post('/submissions').send(validPayload).expect(429);
});
```
Run → Expected: FAIL (no throttling registered, every request returns 201/400, never 429).

**Step 2 — GREEN:** register `ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.SUBMIT_RATE_LIMIT_PER_MIN ?? 30) }])` and `ThrottlerGuard` globally (or scoped to `SubmissionsController`, per NestJS's `@nestjs/throttler` module docs).

Run → Expected: PASS.

**Commit:** `git add backend/src/app.module.ts backend/src/submissions/submissions.controller.ts backend/test/e2e/submissions-rate-limit.e2e-spec.ts && git commit -m "feat(backend): add rate limiting to submission endpoint"`

### Task 1.6: `test:stress` scaffold script (`submission-burst` scenario)

**Why this task exists:** Task 0.1's `package.json` already declares `"test:stress": "node
scripts/stress-scenario.mjs"`, and the Live Verification Strategy section names `npm run
test:stress -- --scenario submission-burst` as this plan's stress scenario. Without this task,
that script file would not exist anywhere in the phase plan and the npm script would be a hollow
promise (a command that fails with `Cannot find module` the first time anyone runs it). This task
creates the minimal scaffold so the command is real, while keeping the exact load profile/pass
thresholds explicitly deferred and non-blocking for v1, per the Risks table.

**Files:**
- Create: `backend/scripts/stress-scenario.mjs`

No RED/GREEN unit test for this task — it is a standalone operational script invoked out-of-band
via `npm run test:stress`, not code exercised by the Vitest suite (same infra-only exception
pattern as Task 0.6's docker-compose wiring). Verified via the manual acceptance check below
instead.

```js
#!/usr/bin/env node
// backend/scripts/stress-scenario.mjs
// Minimal scaffold for the Live Verification Strategy's stress scenario. Implements only
// "submission-burst" today. This is a scaffold proving the npm script is real and runnable, not a
// tuned load-test harness -- exact concurrency profile and pass/fail thresholds beyond "every
// request in the burst succeeds and no data is corrupted" are deferred (see Risks table).
const args = process.argv.slice(2);
const scenarioFlagIndex = args.indexOf('--scenario');
const scenario = scenarioFlagIndex >= 0 ? args[scenarioFlagIndex + 1] : undefined;

const BASE_URL = process.env.STRESS_BASE_URL ?? 'http://localhost:3000';

async function submissionBurst() {
  const limit = Number(process.env.SUBMIT_RATE_LIMIT_PER_MIN ?? 30);
  const concurrency = limit; // stays within the configured rate-limit threshold, per the scenario's own name
  const payload = {
    repoId: 'stress/scenario-repo',
    score: 50,
    level: { index: 1, name: 'L1' },
    dimensions: [],
    frameworkMapping: {},
    commitSha: '0'.repeat(40),
    scannedAt: new Date().toISOString(),
  };
  const statuses = await Promise.all(
    Array.from({ length: concurrency }, () =>
      fetch(`${BASE_URL}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.status),
    ),
  );
  const failures = statuses.filter((status) => status !== 201);
  if (failures.length > 0) {
    console.error(`submission-burst: ${failures.length}/${concurrency} requests did not return 201`, failures);
    process.exitCode = 1;
    return;
  }
  console.log(`submission-burst: ${concurrency}/${concurrency} concurrent submissions to the same repoId succeeded without error`);
}

const scenarios = { 'submission-burst': submissionBurst };

if (!scenario || !scenarios[scenario]) {
  console.error(`Usage: node scripts/stress-scenario.mjs --scenario <${Object.keys(scenarios).join('|')}>`);
  process.exit(1);
}

await scenarios[scenario]();
```

**Verification (acceptance check, not a unit test):**
```bash
cd backend
docker compose up -d --wait
npm run test:stress -- --scenario submission-burst
# Expected: "submission-burst: <N>/<N> concurrent submissions to the same repoId succeeded without error", exit 0
docker compose down -v
```

**Commit:** `git add backend/scripts/stress-scenario.mjs && git commit -m "chore(backend): add test:stress scaffold script for submission-burst scenario"`

---

## Phase 2: Query API — Public Tier

> **Exit Criteria:** A public submission is queryable immediately after insert via both a
> "current" and a "history" endpoint; an unauthenticated caller never sees a private repo's data
> (not in the list endpoint, not via direct repoId lookup — 404, not a filtered-empty 200 that
> would leak existence ambiguity vs. a real 404 for "never existed").

**Strategy:** `incremental`.

### Task 2.1: `GET /repos` (public leaderboard listing, latest-per-repo) (RED/GREEN)

**Files:**
- Create: `backend/src/query/query.controller.ts`, `backend/src/query/query.service.ts`,
  `backend/test/e2e/query-public-list.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('GET /repos returns only the latest submission per public repoId, excludes private repos', async () => {
  await seedSubmission('acme/widgets', { scannedAt: '2026-08-01T00:00:00Z' });
  await seedSubmission('acme/widgets', { scannedAt: '2026-08-10T00:00:00Z' }); // newer, same repo
  await seedSubmission('other/private-repo', { scannedAt: '2026-08-05T00:00:00Z' }, { visibility: 'private' });
  const res = await request(app.getHttpServer()).get('/repos').expect(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].repoId).toBe('acme/widgets');
  expect(res.body[0].scannedAt).toBe('2026-08-10T00:00:00.000Z');
});
```
Run → Expected: FAIL — 404, route doesn't exist.

**Step 2 — GREEN:** `QueryService.listPublicLatest()` — a TypeORM query joining `repos` (`visibility
= 'public'`) to the newest `submissions` row per `repo_id` (via a `DISTINCT ON (repo_id) ... ORDER
BY repo_id, scanned_at DESC` query, Postgres-specific and intentional — matches `buildLeaderboard`'s
dedup-keep-newest semantics but pushed into the DB query rather than app-layer aggregation, since
this now runs per-request over a potentially large table).

Run → Expected: PASS.

**Commit:** `git add backend/src/query backend/test/e2e/query-public-list.e2e-spec.ts && git commit -m "feat(backend): add GET /repos public listing endpoint"`

### Task 2.2: `GET /repos/:repoId` and `GET /repos/:repoId/history` (RED/GREEN)

**Files:**
- Modify: `backend/src/query/query.controller.ts`, `backend/src/query/query.service.ts`
- Create: `backend/test/e2e/query-public-detail.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('GET /repos/:repoId -> 200 latest submission for a public repo', async () => { /* ... */ });
it('GET /repos/:repoId -> 404 for a private repo (unauthenticated)', async () => { /* ... */ });
it('GET /repos/:repoId -> 404 for a repoId that has never submitted', async () => { /* ... */ });
it('GET /repos/:repoId/history -> 200 array ordered newest-first, all entries for a public repo', async () => { /* ... */ });
```
Run → Expected: FAIL (routes don't exist).

**Step 2 — GREEN:** implement both handlers; the private-repo case and the never-existed case both
return **404 with an identical response shape** — deliberate, so an unauthenticated caller cannot
distinguish "this repo is private" from "this repo doesn't exist" (this exact indistinguishability
requirement is re-tested and load-bearing again in Phase 4, Task 4.3, once private repos actually
exist via the API — Task 2.2's version tests it against a directly-seeded-private fixture row).

Run → Expected: PASS.

**Commit:** `git add backend/src/query backend/test/e2e/query-public-detail.e2e-spec.ts && git commit -m "feat(backend): add GET /repos/:repoId and history endpoints"`

---

## Phase 3: Verified Tier

> **Exit Criteria:** A signed submission from a registered, non-revoked key is persisted with
> `verified: true`; a submission with an invalid signature is rejected outright (400, not
> persisted at all) — never persisted with `verified: false` as if it were merely unsigned; a
> revoked key's signature is rejected the same way. **Checkpoint type: `human_verify` (HITL)** —
> per the RFC's own Phase Autonomy Classification, a human must review the signature-verification
> code path before this phase is marked done, not just green tests (this is the RFC's own
> highest-risk-alongside-Phase-4 classification, carried forward unchanged).

**Strategy:** `incremental`.

### Task 3.1: `POST /accounts` — account registration + API key issuance (RED/GREEN)

**Files:**
- Create: `backend/src/accounts/accounts.controller.ts`, `backend/src/accounts/accounts.service.ts`,
  `backend/test/e2e/accounts.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('POST /accounts { orgName } -> 201 { accountId, apiKey }, apiKey is never persisted in plaintext', async () => {
  const res = await request(app.getHttpServer()).post('/accounts').send({ orgName: 'acme' }).expect(201);
  expect(res.body.apiKey).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  const row = await accountsRepo.findOneBy({ id: res.body.accountId });
  expect(row?.apiKeyHash).not.toBe(res.body.apiKey);
  expect(row?.apiKeyHash).toHaveLength(64); // sha256 hex
});
it('POST /accounts with a duplicate orgName -> 409', async () => { /* ... */ });
```
Run → Expected: FAIL (404, no route).

**Step 2 — GREEN:** generate a 32-byte random API key (`crypto.randomBytes(32).toString('base64url')`), store `crypto.createHash('sha256').update(apiKey).digest('hex')` as `api_key_hash`,
return the raw key **only in this one response** — never retrievable again (matches the private-key-never-transmitted-or-stored spirit of Ed25519, applied to the API key too).

Run → Expected: PASS.

**Commit:** `git add backend/src/accounts backend/test/e2e/accounts.e2e-spec.ts && git commit -m "feat(backend): add account registration with hashed API key issuance"`

### Task 3.2: `ApiKeyGuard` (RED/GREEN)

**Files:**
- Create: `backend/src/auth/api-key.guard.ts`, `backend/src/auth/api-key.guard.spec.ts`

**Step 1 — RED:**
```ts
it('rejects a request with no Authorization header', () => { expect(guard.canActivate(ctxWithNoHeader)).rejects... });
it('rejects a request whose bearer token does not match any stored hash', async () => { /* ... */ });
it('attaches the resolved account to the request when the key matches', async () => { /* ... */ });
```
Run → Expected: FAIL — `ApiKeyGuard` doesn't exist.

**Step 2 — GREEN:** implement `canActivate` — hash the presented bearer token with SHA-256, look up
`accounts.api_key_hash`, attach `request.account = account` on match, throw `UnauthorizedException`
otherwise.

Run → Expected: PASS.

**Commit:** `git add backend/src/auth/api-key.guard.ts backend/src/auth/api-key.guard.spec.ts && git commit -m "feat(backend): add ApiKeyGuard for account-scoped endpoints"`

### Task 3.3: `POST /accounts/:accountId/signing-keys` — key registration (RED/GREEN)

**Files:**
- Create: `backend/src/signing-keys/signing-keys.controller.ts`,
  `backend/src/signing-keys/signing-keys.service.ts`,
  `backend/test/e2e/signing-keys.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('registers a public key for the authenticated account -> 201 { keyId }', async () => { /* Authorization: Bearer <apiKey from 3.1> */ });
it('rejects registration for :accountId that does not match the authenticated account -> 403', async () => { /* ... */ });
```
Run → Expected: FAIL (404, no route).

**Step 2 — GREEN:** `@UseGuards(ApiKeyGuard)`, controller compares `request.account.id` to the
`:accountId` route param before delegating to the service (this IS layer (a) of the two-layer
tenant-isolation pattern — re-used identically in Phase 4).

Run → Expected: PASS.

**Commit:** `git add backend/src/signing-keys backend/test/e2e/signing-keys.e2e-spec.ts && git commit -m "feat(backend): add signing-key registration endpoint"`

### Task 3.4: Ed25519 verification helper (RED/GREEN — the security-critical unit)

**Files:**
- Create: `backend/src/signing/canonical-payload.ts`, `backend/src/signing/ed25519.ts`,
  `backend/src/signing/ed25519.spec.ts`

`canonical-payload.ts` (per Durable Decision 10 — server-reconstructed only, fixed key order):
```ts
export interface CanonicalSubmissionFields {
  repoId: string; score: number; level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
  frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  commitSha: string; scannedAt: string;
}
export function buildCanonicalPayload(f: CanonicalSubmissionFields): string {
  const sortedMapping = Object.fromEntries(Object.keys(f.frameworkMapping).sort().map((k) => [k, f.frameworkMapping[k]]));
  return JSON.stringify({
    repoId: f.repoId, score: f.score, level: { index: f.level.index, name: f.level.name },
    dimensions: f.dimensions.map((d) => ({ id: d.id, title: d.title, earned: d.earned, max: d.max, percent: d.percent })),
    frameworkMapping: sortedMapping, commitSha: f.commitSha, scannedAt: f.scannedAt,
  });
}
```

**Step 1 — RED:**
```ts
// ed25519.spec.ts — uses a fixed, checked-in test keypair generated once via node:crypto
it('verifies a valid signature over the canonical payload', () => {
  expect(verifyEd25519(publicKeyBase64, buildCanonicalPayload(fields), validSignatureBase64)).toBe(true);
});
it('rejects a signature over a tampered payload (score changed by 0.1)', () => {
  const tampered = buildCanonicalPayload({ ...fields, score: fields.score + 0.1 });
  expect(verifyEd25519(publicKeyBase64, tampered, validSignatureBase64)).toBe(false);
});
it('rejects a well-formed but wrong-key signature', () => { /* signed with a different keypair */ });
it('the fixed fixture vector produces a byte-identical canonical string every run (determinism check)', () => {
  expect(buildCanonicalPayload(fields)).toBe(EXPECTED_FIXTURE_CANONICAL_STRING);
});
```
Run → Expected: FAIL — `verifyEd25519 is not a function`.

**Step 2 — GREEN:**
```ts
import { createPublicKey, verify } from 'node:crypto';

export function verifyEd25519(publicKeyBase64: string, payload: string, signatureBase64: string): boolean {
  const x = Buffer.from(publicKeyBase64, 'base64').toString('base64url');
  const keyObject = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
  return verify(null, Buffer.from(payload, 'utf8'), keyObject, Buffer.from(signatureBase64, 'base64'));
}
```

Run → Expected: PASS.

**Commit:** `git add backend/src/signing && git commit -m "feat(backend): add Ed25519 signature verification and canonical payload builder"`

### Task 3.5: Wire signature verification into `POST /submissions` (RED/GREEN)

**Files:**
- Modify: `backend/src/submissions/submissions.service.ts`, `backend/src/submissions/submissions.controller.ts`
- Create: `backend/test/e2e/submissions-verified.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('a signed submission from a registered key -> 201, verified: true', async () => { /* register key, sign payload, POST */ });
it('a submission with keyId set but an invalid signature -> 400, NOT persisted at all', async () => {
  await request(app.getHttpServer()).post('/submissions').send({ ...validPayload, keyId, signature: 'invalid-base64-garbage' }).expect(400);
  expect(await submissionsRepo.count()).toBe(0); // critical: never persisted as verified:false
});
it('a submission signed with a revoked key -> 400, not persisted', async () => { /* revoke, then attempt */ });
it('a submission with an unknown keyId -> 400', async () => { /* ... */ });
```
Run → Expected: FAIL — signature fields are currently ignored, every submission persists as
`verified: false` regardless of a bad signature (this is the exact "silently downgraded to
unverified" bug the design file's Error Handling section explicitly forbids — the RED step must
demonstrate this failure mode concretely, not just "route missing").

**Step 2 — GREEN:** in `buildInsertableSubmission`, if `dto.keyId` is present: look up the
`signing_keys` row (must exist and `revoked_at IS NULL`), build the canonical payload from the
already-validated fields, call `verifyEd25519`; if verification fails for **any** reason (unknown
key, revoked key, bad signature) return `{ ok: false, reason: 'invalid signature' }` — the
controller then returns 400 and writes a `rejected_submissions` audit row, exactly like any other
malformed submission (Task 1.4's existing path, reused unchanged). Only on a passing verification
does `verified: true` get set on the inserted row.

Run → Expected: PASS.

**Commit:** `git add backend/src/submissions backend/test/e2e/submissions-verified.e2e-spec.ts && git commit -m "feat(backend): wire Ed25519 signature verification into submission endpoint"`

**Phase 3 exit checkpoint (HITL):** before marking this phase done, a human reviews: (1) Task 3.4's
test file for a wrong-key/tampered-payload negative case, (2) Task 3.5's "not persisted at all"
assertions (not just a status-code check), (3) that `verifyEd25519` is never called with
attacker-controlled canonical-string input (only server-built strings — grep the diff for any path
that accepts a `canonicalPayload` field from the request body; there must be none).

---

## Phase 4: Private Tier + Authenticated Queries

> **Exit Criteria:** An account owner can toggle their own repo to `private` and query its own
> full history (current + historical); an unauthenticated or wrong-account caller gets 404 (not
> 403) for that same private repo, both from the detail endpoint and absent from the public list
> endpoint. **Both tenant-isolation layers (guard-level ownership check AND mandatory-`WHERE`
> repository scoping) must both be present and both independently tested** — do not mark this
> phase done if only one layer exists (this repo's established two-layer trust pattern, and the
> RFC's own highest Risk-table score, 10, is exactly this failure mode). **Checkpoint type:
> `human_verify` (HITL)**, per the RFC's Phase Autonomy Classification.

**Strategy:** `incremental`.

### Task 4.1: `PATCH /accounts/:accountId/repos/:repoId/visibility` (RED/GREEN)

**Files:**
- Create: `backend/src/repos/repos.controller.ts`, `backend/test/e2e/repos-visibility.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('owner can set their own repo to private -> 200', async () => { /* Bearer <owner apiKey> */ });
it('a different account cannot change visibility for a repo they do not own -> 403', async () => { /* Bearer <other account apiKey> */ });
it('unauthenticated request -> 401', async () => { /* no Authorization header */ });
```
Run → Expected: FAIL (404, no route).

**Step 2 — GREEN:** `@UseGuards(ApiKeyGuard)`; controller loads the `repos` row by `repoId`, checks
`repo.accountId === request.account.id` (layer (a) — guard/controller-level check), 403s on
mismatch, else updates `visibility`.

Run → Expected: PASS.

**Commit:** `git add backend/src/repos/repos.controller.ts backend/test/e2e/repos-visibility.e2e-spec.ts && git commit -m "feat(backend): add repo visibility toggle endpoint"`

### Task 4.2: Mandatory-`WHERE`-scoped private history query (layer b) (RED/GREEN)

**Files:**
- Modify: `backend/src/query/query.service.ts`
- Create: `backend/test/integration/query.service.int-spec.ts` (integration — directly tests the
  repository method's SQL behavior, not just the HTTP layer, so this layer is provably independent
  of the controller-level check in Task 4.1/4.3; placed under `test/integration/` — not
  `src/query/` — to match Task 0.4's `schema.int-spec.ts` precedent and
  `vitest.integration.config.ts`'s `include: ['test/e2e/**/*.e2e-spec.ts',
  'test/integration/**/*.int-spec.ts']` glob, which does not discover `.int-spec.ts` files placed
  under `src/`; imports the service under test via a relative path, e.g. `import { QueryService }
  from '../../src/query/query.service'`)

**Step 1 — RED:**
```ts
it('getPrivateHistory requires an accountId parameter and only returns rows the account owns', async () => {
  const { repoId } = await seedPrivateRepoWithSubmission({ accountId: accountA });
  const rowsForOwner = await queryService.getPrivateHistory(repoId, accountA);
  expect(rowsForOwner.length).toBeGreaterThan(0);
  const rowsForOther = await queryService.getPrivateHistory(repoId, accountB);
  expect(rowsForOther).toEqual([]); // never throws with account info leaked; empty result
});
it('there is no repository method that queries a private submission by repoId alone (no accountId param)', () => {
  // structural assertion: the only exported query-service method accepting a bare repoId is the
  // public-tier one (Task 2.2), which itself filters visibility = 'public' — grep-verifiable, not
  // just test-verifiable; documented here as the property this task must not regress
  expect(typeof queryService.getPrivateHistory).toBe('function');
  expect(queryService.getPrivateHistory.length).toBeGreaterThanOrEqual(2); // (repoId, accountId)
});
```
Run: `npx vitest run --config vitest.integration.config.ts test/integration/query.service.int-spec.ts`
Expected: FAIL — `getPrivateHistory is not a function`.

**Step 2 — GREEN:** implement `getPrivateHistory(repoId: string, accountId: string)` whose TypeORM
query builder **always** includes `.andWhere('repo.accountId = :accountId', { accountId })` — no
conditional branch that omits it, and no separate "admin" method that skips it.

Run → Expected: PASS.

**Commit:** `git add backend/src/query backend/test/integration/query.service.int-spec.ts && git commit -m "feat(backend): add mandatory account-scoped private history query (tenant isolation layer 2)"`

### Task 4.3: Wire private tier into the read endpoints (RED/GREEN)

**Files:**
- Modify: `backend/src/query/query.controller.ts`
- Create: `backend/test/e2e/query-private.e2e-spec.ts`

**Step 1 — RED:**
```ts
it('owner with valid API key sees their own private repo history -> 200', async () => { /* ... */ });
it('a different authenticated account gets 404 (not 403) for another account\'s private repo', async () => { /* ... */ });
it('unauthenticated caller gets 404 (not 401) for a private repo — same shape as "never existed"', async () => { /* ... */ });
it('a private repo never appears in GET /repos (public listing), even when queried by its owner', async () => { /* ... */ });
```
Run → Expected: FAIL (existing endpoints from Phase 2 still 404 unconditionally for private repos —
this RED step should show the *unauthenticated-owner* case is not yet reachable at all, since no
auth-aware branch exists yet on these routes).

**Step 2 — GREEN:** extend `GET /repos/:repoId` and `/history` to accept an optional
`ApiKeyGuard`-style soft-auth (a variant that doesn't throw when the header is absent, only when
present-and-invalid); if the repo is private, require a matching authenticated account (layer a)
*and* route through `getPrivateHistory` (layer b) rather than the public-only query path; 404
(never 403) whenever ownership doesn't resolve, including the fully-unauthenticated case.

Run → Expected: PASS.

**Commit:** `git add backend/src/query backend/test/e2e/query-private.e2e-spec.ts && git commit -m "feat(backend): wire private-tier visibility into read endpoints"`

**Phase 4 exit checkpoint (HITL):** before marking this phase done, a human reviews: (1) that
Task 4.2's `getPrivateHistory` query builder has no code path omitting the `accountId` filter
(read the diff, not just the green test), (2) that every private-repo negative case returns 404,
never 403 or a distinguishable error shape, (3) that the public-listing exclusion (last RED-step
assertion in Task 4.3) genuinely queries the same `visibility = 'public'` filter from Task 2.1
rather than a parallel, potentially-drifting filter.

---

## Phase 5: Container Packaging Hardening + Full-Stack Smoke Test

> **Exit Criteria:** A production-shaped multi-stage Docker image builds and runs standalone
> (`docker run`, no bind-mounted source); the full Live Verification Strategy proof-scenario list
> passes end-to-end against a freshly built image + fresh Postgres volume. Hosting/cloud provider
> is still not chosen (unchanged, out of scope).

**Strategy:** `mvp_first` — only what's needed to prove the containerized artifact works
end-to-end; deeper image-size/security hardening (distroless base, non-root user, multi-arch
builds) is noted as a fast-follow, not blocking v1.

### Task 5.1: Multi-stage production `Dockerfile`

**Files:** Modify `backend/Dockerfile` (append two new named stages **after** the existing `dev`
stage from Task 0.6 — `FROM node:22-alpine AS build`: `npm ci && npm run build`; `FROM
node:22-alpine AS runtime`: `npm ci --omit=dev`, copy `dist/` from the `build` stage,
`CMD ["node", "dist/main.js"]`, run as a non-root user). `backend/docker-compose.yml` is **not
modified** in this task — its `api` service already pins `build.target: dev` explicitly (Task
0.6), so appending `build`/`runtime` stages after `dev` in the same Dockerfile does not change
which stage `docker compose build`/`up` selects for local dev; local dev stays on the `dev` stage
both before and after this task.

**Verification:**
```bash
cd backend
docker build --target runtime -t harnesslens-backend:smoke .
docker run --rm -d -p 3000:3000 --env-file .env.example --name backend-smoke harnesslens-backend:smoke
# (with a reachable Postgres per .env.example's DATABASE_URL, e.g. the compose db service)
curl -sf http://localhost:3000/health
docker stop backend-smoke
```
Expected: `{"status":"ok"}`, container starts without the dev `Dockerfile` target or bind mounts.

**Commit:** `git add backend/Dockerfile && git commit -m "feat(backend): add production multi-stage Dockerfile"`

### Task 5.2: Full-stack proof-scenario run

**Files:** Create `backend/scripts/run-live-proof.sh` — runs `docker compose up -d --wait`, then
runs `npm run test:integration -- test/e2e` (the full e2e suite from Phases 0-4) against the
compose-managed stack instead of a Testcontainers-spun one, then `docker compose down -v`.

**Verification:** `cd backend && ./scripts/run-live-proof.sh` → Expected: all e2e specs from every
prior phase pass against the actual compose stack (not just Testcontainers-isolated runs), proving
the docker-compose wiring itself (env vars, service dependency ordering, migration-before-api
ordering) is correct end-to-end.

**Commit:** `git add backend/scripts/run-live-proof.sh && git commit -m "chore(backend): add full-stack live proof-scenario runner"`

### Task 5.3: `backend/README.md`

**Files:** Create `backend/README.md` — local dev (`docker compose up`), running tests (unit vs.
integration vs. live-proof), the canonical-payload contract (Task 3.4's `buildCanonicalPayload`
shape, for a future client-SDK implementor), and an explicit "hosting is not yet decided" note
matching the RFC's deferred scope.

**Commit:** `git add backend/README.md && git commit -m "docs(backend): add backend README"`

---

## Alternatives (implementation-approach choices considered within this plan, not stack-level)

- **Tenant isolation: mandatory-`WHERE`-clause repository scoping (chosen) vs. Postgres
  row-level security (RLS).** RLS is a real, valid second-layer mechanism (the RFC's own Risks
  table names it as an example) but requires `SET LOCAL app.current_account_id` inside an explicit
  transaction per request, which only works correctly if every request reliably uses the same
  pooled connection for the `SET` and the subsequent query (TypeORM's default pool does not
  guarantee this without an explicit `QueryRunner`/transaction wrapper around every request). The
  mandatory-parameter repository method is simpler to implement correctly, simpler to unit-test in
  isolation (Task 4.2's structural test), and carries no connection-pooling correctness risk.
  **Drawback of the chosen approach:** relies on code discipline (no future method may omit the
  `accountId` filter) rather than a DB-enforced guarantee that survives even a future ORM-level
  mistake — RLS remains a documented hardening candidate for a later phase, not discarded, if
  audit/compliance requirements later demand a DB-enforced guarantee.
- **Signature library: native `node:crypto` (chosen) vs. a third-party library (e.g. `tweetnacl`,
  `@noble/ed25519`).** Native `node:crypto` keeps the dependency list minimal (repo-wide bias) and
  Node has had stable Ed25519 support since v12 — no version-support risk on Node ≥22. **Drawback:**
  the raw-key-to-JWK wrapping (Task 3.4) is slightly more manual than a purpose-built library's
  API, but is a small, fully-tested, one-time helper.

## Risks and Mitigations

| Risk | P | I | Score | Mitigation |
|---|---|---|---|---|
| Vitest's default esbuild transform silently drops NestJS's required `emitDecoratorMetadata` output, breaking constructor-injected DI for nearly every provider from Task 1.2 onward (found during independent fresh plan review) | 3 | 5 | 15 | Phase 0 Task 0.2 wires `unplugin-swc` into both `vitest.config.ts` and `vitest.integration.config.ts` before any DI-dependent provider is written, with a RED/GREEN `di-probe.spec.ts` regression guard kept permanently in the suite |
| Public write endpoint becomes a spam/abuse vector (unchanged from RFC) | 4 | 4 | 16 | Phase 1 Task 1.5 rate limiting + visible `verified: false` "self-reported" field |
| Multi-tenant data leak (unchanged from RFC, highest-scored risk) | 2 | 5 | 10 | Phase 4's two independent layers (Task 4.1 guard check + Task 4.2 mandatory-WHERE query), both independently unit/integration-tested, plus a Phase 4 HITL checkpoint |
| Client/server canonical-payload mismatch breaks all valid signatures for a real submitter | 3 | 4 | 12 | Task 3.4's fixed fixture-vector determinism test is the executable contract; `backend/README.md` (Task 5.3) documents the exact canonical construction for a future client SDK; server never accepts a client-supplied canonical string as input (Durable Decision 10) removes the "client lies about what it signed" sub-case entirely |
| `useDefineForClassFields`/decorator/ESM tsconfig conflict silently breaks TypeORM entities (new risk found during this plan's own Codebase Reality Check) | 2 | 4 | 8 | Resolved structurally in Phase 0 Task 0.1 (non-extending tsconfig, `useDefineForClassFields: false`) before any entity is written, not discovered later |
| Account/repo auto-provisioning (Durable Decision 6) allows an attacker to squat an `org_name` before the real org registers, blocking that org's later `POST /accounts` (409 on duplicate `org_name`) | 3 | 3 | 9 | Documented limitation, not silently ignored: `backend/README.md` (Task 5.3) notes this as a known v1 limitation; a future fast-follow could let `POST /accounts` claim an auto-provisioned account if the caller can prove control of an already-`verified: true` submission for that org — explicitly out of scope for this plan, flagged rather than solved |
| Private-key compromise on submitter's side (unchanged from RFC) | 2 | 4 | 8 | Ed25519 client-side-only key + `signing_keys.revoked_at` (Task 3.3 exposes revocation; DELETE endpoint) |
| Schema drift between `harnesslens`'s `Report` shape and the Submission API's DTO (unchanged from RFC) | 3 | 3 | 9 | `CreateSubmissionDto` (Task 1.1) mirrors `parseSubmission`'s exact field set 1:1, documented in Context References as the canonical source to re-check against on future `Report` shape changes |
| `harnesslens` package not yet public leaves the API unreachable by real outside submitters (unchanged from RFC) | 3 | 2 | 6 | Explicitly out of scope for this plan to resolve, same as the RFC — a known adoption blocker, not a backend defect |

## Success Criteria

- [ ] `cd backend && npm ci && npm run build && npm test && npm run test:integration` all exit 0
- [ ] `docker compose up -d --wait && curl -sf http://localhost:3000/health/db` returns
      `{"status":"ok"}`
- [ ] Every proof scenario in the Live Verification Strategy section passes via
      `./backend/scripts/run-live-proof.sh`
- [ ] `git status` shows no modifications to `src/`, `action/`, `leaderboard/`, or root
      `package.json` — only new files under `backend/` (and this plan's own doc)
- [ ] Phase 3 and Phase 4 HITL checkpoints both have recorded human sign-off before being marked
      done
- [ ] No regression: `npm test` at the repo root (existing `harnesslens` package) and `cd
      leaderboard && npm test` both still pass unmodified
