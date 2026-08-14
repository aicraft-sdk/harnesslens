# Live Hosted Backend for harnesslens — Decision RFC

> **For Claude:** This is a DECISION RFC, not an execution plan. Do not implement anything from
> this document. Its job is to let the user pick a direction. Once a direction is approved, a
> follow-up `execution_plan` (with TDD task breakdown) must be created before any code changes.
> **Design:** See `docs/plans/2026-08-13-live-hosted-backend-design.md` for the user-approved
> purpose, users, approach choice (Option A), architecture shape, components, data flow, and
> error-handling philosophy. This RFC compares concrete technology options against that
> already-approved shape — it does not re-derive it.

**Goal:** Recommend a concrete, containerized technology stack (API framework, database, and
signature scheme) for item 1 of `ARCHITECTURE.md`'s "Future direction" list — a live, multi-tenant,
queryable scoring backend with signed/verifiable attestations and tiered public/private scoring —
so the user can approve a direction before any implementation planning begins.

**Architecture:** A new, standalone containerized service (Submission API, Query API, data store,
identity/key registry) sitting alongside — never modifying — the existing zero-network scorer and
the static, PR-gated `leaderboard/`. Every design choice below is evaluated against how closely it
preserves this repo's two existing trust-boundary conventions: allowlist-only input validation
(`leaderboard/src/parse-submission.ts`) and "reject/skip with a reason, never silently drop"
error handling (`leaderboard/src/build-leaderboard.ts`).

**Tech Stack (recommended, pending approval):** NestJS + PostgreSQL + TypeORM + Ed25519 signature
verification, packaged as Docker containers orchestrated locally via docker-compose. Revised from
this RFC's original Fastify-based recommendation because the team is already familiar with
NestJS — a decision factor the original pass never weighed (Fastify remains a fully documented
alternative, not discarded). See "Recommended Stack" below for full rationale and named
alternatives.

**Prerequisites:** None — this is a planning artifact. No code changes, dependencies, or
infrastructure exist yet for this surface.

**Durable Decisions (carried forward from the approved design, not reopened here):**
- Full live multi-tenant scoring API + DB with signed attestations as an integrated trust tier
  (Option A) — not an attestation-only service, not a managed BaaS.
- Public/private tiering and immutable historical time-series storage are required capabilities.
- Packaging is containerized; hosting/cloud-provider selection is explicitly deferred.
- The existing scorer and static leaderboard are not modified by this initiative.

**Amendment (2026-08-13):** The original pass of this RFC recommended Fastify as the API
framework. That recommendation is revised here to NestJS because the team is already familiar
with NestJS — a concrete decision factor the original comparison never weighed. Fastify remains
in this document as a fully documented, honestly-assessed alternative (see "Alternative Stacks",
Stack A) — it is not deleted or reduced to a strawman. Axis 2 (data store), Axis 3 (signature
scheme), and Axis 4 (dev environment) are unaffected; this amendment also adds Axis 5 (ORM/query
layer) as its own first-class comparison, since NestJS's idiomatic ORM pairing differs from
Fastify's, and re-derives the ORM choice explicitly rather than carrying Drizzle over by default.

---

## Motivation / Current State

`harnesslens` (`src/`) is a zero-network, filesystem/build-time-only scorer consumed via CLI,
GitHub Action, and badge/markdown renderers — see `ARCHITECTURE.md`'s "Determinism/safety
guarantees" section: no HTTP requests, no shelling out, no target-repo mutation. `leaderboard/`
extends this with a companion static-site generator: self-reported `harnesslens --json` output is
submitted via pull request against `leaderboard/submissions/`, parsed by an allowlist parser,
aggregated (dedup by `repoId` keeping newest, staleness-flagged past 90 days), and published to
GitHub Pages on a schedule / on `submissions/**` changes / on manual dispatch
(`.github/workflows/rebuild-leaderboard.yml`).

Both surfaces are deliberately static and CI-driven — there is no live write path anywhere in this
repo today. `ARCHITECTURE.md`'s "Future direction" section names this gap explicitly: a dynamic,
queryable service with signed/verifiable attestations, a live submission API, and tiered
public/private scoring would be "a new surface, not an extension of the existing scorer or the
static leaderboard" — the product's path toward the category leaders it is closest to structurally
(OpenSSF Scorecard, Socket.dev, Snyk Advisor), all of which succeed because they are live and
API-backed rather than periodic/static.

This RFC assumes the shape already approved in the design file (Submission API, Query API, data
store, identity/key registry — see that file's "Components" section) and focuses on the concrete
technology choices needed to build it.

## Requirements Recap (from the approved design — not re-litigated here)

- Multi-tenant: any org/repo can submit and query scores once the underlying package is public.
- Two trust tiers: *basic* (live-submitted, unsigned, "self-reported" badge) and *verified*
  (submitter signs the payload with a registered keypair; API verifies before marking
  "verified").
- Public/private tiering: public repos land on a public queryable leaderboard successor; private
  orgs' private-repo scores are visible only to their own account.
- Historical time-series storage: every submission stored immutably, not just the latest — enables
  trend queries and score-regression CI gates.
- Containerized packaging; hosting provider deferred.

## Constraints

- Additive only — `src/` (scorer), `action/` (GitHub Action), and `leaderboard/` are untouched by
  this work. This RFC describes a new top-level surface (proposed: a new `backend/` or `service/`
  workspace member, sibling to `leaderboard/`, decided at execution-plan time).
- Containerized packaging assumed; no specific cloud/hosting provider is chosen or implied here.
- Both existing packages (`harnesslens`, `harnesslens-leaderboard`) currently ship with
  `"dependencies": {}` — a deliberate zero-runtime-dependency stance for the *scorer/parsing*
  layer. A live API + DB service cannot realistically stay zero-dependency (it needs a web
  framework and a DB driver at minimum), but every option below is evaluated partly on how well it
  preserves this repo's general bias toward a small, auditable dependency surface rather than a
  large opinionated framework.

## Out of Scope

- Items 2-4 of the `ARCHITECTURE.md` "Future direction" list (formal certification,
  `runMultiRepoAudit` relationship, plugin-shaped-repo detection gap).
- Implementing or deploying the backend.
- Choosing a specific hosting provider or region.
- Embeddable live badge rendering (fast-follow after the Query API exists, not core RFC scope).

---

## Codebase Reality Check

- **Verified files / surfaces inspected:** `ARCHITECTURE.md` ("Future direction" section),
  `leaderboard/README.md` (full — Pipeline, Submission schema, "Why PR-based, not direct-commit",
  Security model), `leaderboard/src/parse-submission.ts`, `leaderboard/src/build-leaderboard.ts`,
  `leaderboard/src/render.ts`, `package.json` (root), `leaderboard/package.json`,
  `docs/plans/2026-08-13-live-hosted-backend-design.md` (the approved design this RFC builds on).
- **Existing patterns / constraints confirmed from the repo:**
  - Both `harnesslens` and `harnesslens-leaderboard` ship `"dependencies": {}` — TypeScript,
    ESM (`"type": "module"`), Node `>=22.0.0`, `vitest` for tests, no runtime dependencies at all
    today. This is a deliberate minimal-dependency stance, not an oversight.
  - `parseSubmission` (`leaderboard/src/parse-submission.ts`) validates exactly 7 named fields and
    rebuilds the object field-by-field — confirmed by direct read, not inferred from the README
    summary alone.
  - `buildLeaderboard` (`leaderboard/src/build-leaderboard.ts`) is pure aggregation: dedups by
    `repoId` keeping newest `scannedAt`, flags entries older than a `STALE_THRESHOLD_DAYS`
    constant, and routes every rejected/superseded file into a `skipped` list with a reason rather
    than dropping it.
  - `render.ts` builds table cells via `.textContent` only, never `.innerHTML` — confirmed by
    direct read.
  - No `backend/`, `service/`, `api/`, or database-adjacent directory exists anywhere in this repo
    today — this RFC's proposed surface has zero prior art in-repo to reconcile against; it is a
    genuinely new addition, not a refactor of something existing.
  - No `docker-compose.yml`, `Dockerfile`, or container tooling exists in this repo today — the
    containerized-packaging assumption in this RFC is new, not a continuation of an existing
    pattern.
- **Pressure points / contradictions:** none found. The proposed new surface does not touch,
  import from, or get imported by `src/`, `action/`, or `leaderboard/` — it is additive by
  construction, consistent with the Constraints section above. The one real tension is the
  minimal-dependency convention above versus the unavoidable need for a web framework + DB driver
  in a live service; this is addressed explicitly in "Constraints" and factored into the framework
  comparison (Axis 1) rather than ignored.

## Assumption Ledger

- **Proven by code:** the exact shape of `ValidatedSubmission` (7 fields), the allowlist-rebuild
  and `__proto__`/`constructor`/`prototype` rejection discipline in `parseSubmission`, the
  "skipped with reason" aggregation behavior in `buildLeaderboard`, the `.textContent`-only
  rendering rule in `render.ts`, and the zero-runtime-dependency state of both existing
  `package.json` files.
- **Inferred:** that a new `backend/`-style workspace member (sibling to `leaderboard/`) is the
  right home for this surface at execution-plan time — reasonable given the existing
  `leaderboard/` precedent as a sibling package, but not yet decided; this RFC does not commit to
  a directory name or workspace wiring.
- **Needs user confirmation (deferred to execution-plan approval, not blocking this RFC):** the
  Recommended Stack itself (NestJS + PostgreSQL + TypeORM + Ed25519) is this RFC's recommendation
  for the user to approve or override — by design, that is the artifact's output, not a hidden
  assumption baked in without being surfaced as a choice. The team's stated familiarity with
  NestJS is taken as given (a user-provided decision factor, not independently verifiable from the
  repo) — flagged here for transparency, not treated as a blocking gap.

## Plan-vs-Code Gaps

| Current code / behavior | Planned change | Gap / risk | Plan response |
|---|---|---|---|
| No live write path exists anywhere in this repo; scorer and leaderboard are both build-time/CI-only | New Submission API accepting live, unauthenticated-by-default (basic tier) writes | Live writes remove the PR-review trust gate the leaderboard relies on today | Rate limiting + schema validation + basic-tier "self-reported" badge stand in for the missing human-review step (see Security/Trust-Boundary Mapping table) |
| Both existing packages have zero runtime dependencies | A live service necessarily adds a web framework + DB driver + ORM | Breaks the repo's zero-dependency precedent | Explicitly acknowledged in Constraints. Axis 1 (API framework) now weighs team familiarity alongside dependency-surface size, and NestJS is a larger dependency surface than the originally-recommended Fastify; this is an explicit, accepted tradeoff (velocity/correctness from familiarity over minimal footprint), not an oversight. Axis 5 (ORM/query layer, added in this amendment) still applies the minimal-dependency bias where it doesn't conflict with the NestJS choice — TypeORM over Prisma specifically to avoid Prisma's codegen-binary dependency, the same reasoning the original RFC used to reject Prisma regardless of framework |
| No container tooling exists in this repo | New `Dockerfile`(s) + `docker-compose.yml` | New operational surface with no in-repo precedent to match against | Design docker-compose shape (Axis 4) after the existing `nvm use` + `npm run build`/`dev` local-dev pattern, so the container only replaces "connect to a mock" with "connect to a real Postgres," not the whole dev workflow |
| `parseSubmission`'s allowlist rule is currently enforced only against files in `leaderboard/submissions/` (a PR-reviewed, filesystem-based input) | Same discipline must be re-implemented against live HTTP request bodies | No existing HTTP-layer validation code to reuse directly (only the filesystem-parsing version) | Recommended Stack's "Concrete request-validation carryover" explicitly re-derives the same rule (allowlist schema, field-by-field reconstruction, prototype-pollution key rejection) at the NestJS DTO + `ValidationPipe` layer, rather than assuming it transfers automatically |

## Phase Dependency Map (Post-Approval Roadmap)

- **Phase 0** (Schema & local dev environment): depends on the user approving a stack in this RFC;
  creates the Postgres schema + docker-compose environment; enables Phases 1-4, all of which need
  a running DB to persist or query against.
- **Phase 1** (Submission API, basic tier): depends on Phase 0's schema and running environment;
  creates the first live write path (unsigned submissions only); enables Phase 2 (something must
  exist to query) and Phase 3 (signature verification is added on top of this same endpoint).
- **Phase 2** (Query API, public tier): depends on Phase 1 having persisted at least one
  submission shape to query against; creates the first live read path; enables Phase 4's
  authenticated/historical query extensions.
- **Phase 3** (Verified tier): depends on Phase 1's Submission API existing (adds signature
  verification to the same endpoint, does not replace it) and on the identity/key registry table
  from Phase 0's schema; enables a "verified" badge distinction Phase 2/4's Query API can surface.
- **Phase 4** (Private tier + authenticated queries): depends on Phase 2's Query API and Phase 0's
  `visibility`/`account_id` schema columns; enables the full public/private tiering requirement
  from the approved design.

## Phase Autonomy Classification (Post-Approval Roadmap — illustrative)

| Phase | Checkpoint Type | Classification | Reason |
|---|---|---|---|
| Phase 0 | none | AFK | Schema + local docker-compose wiring is mechanical once the stack is approved — no ambiguous decisions remain |
| Phase 1 | none | AFK | Re-implements an already-decided validation discipline (allowlist, field-by-field rebuild) against a new transport; no open design questions |
| Phase 2 | none | AFK | Read-path scoped to public-only data; no auth design decisions in this phase |
| Phase 3 | human_verify | HITL | Signature verification is the security-critical core of the "verified" trust tier — the design's own error-handling rule ("never silently downgrade an invalid signature") warrants a human check before this phase is marked done, not just green tests |
| Phase 4 | human_verify | HITL | Public/private tenant isolation is the highest-impact risk in this RFC's own Risks table (Score 10) — a human should verify the DB-level isolation layer independently of the API-level check before this phase is marked done |

---

## Decision Axes and Concrete Options

Five separable technology axes need a decision (Axis 5, ORM/query layer, added in this amendment —
see its section below for why it was split out on its own). Each is evaluated individually below,
then combined into named, internally-consistent stacks (Recommended Stack + three alternatives) so
the comparison stays concrete rather than abstract.

### Axis 1 — API Framework (Node/TypeScript, matching the existing repo's stack)

Team familiarity is included below as an explicit decision factor (added in this amendment) — the
original comparison scored only technical fit against this repo's existing patterns and never
weighed how well the team already knows a given framework, which materially affects real-world
delivery speed, code-review quality, and mistake rate on a first, security-relevant live surface.

| Option | Team Familiarity | Fit |
|---|---|---|
| **NestJS** — **recommended, see "Recommended Stack" below** | **Team is already familiar with NestJS.** This is a decisive, concrete factor: known tooling reduces onboarding cost, review friction, and implementation-mistake risk specifically on Phase 3/4 (signature verification, tenant isolation) — the two phases this RFC's own Phase Autonomy Classification already flags as `HITL`/highest-risk. | Full DI framework with decorators and an opinionated, class-based architecture — this does genuinely diverge from this repo's established pattern of small, composable, individually-testable pure functions (`buildLeaderboard`, `parseSubmission`), and its dependency surface (DI container, module system, decorators, `reflect-metadata`) is the largest of the four options. Those objections are real and unchanged from the original assessment. What changed is the counterweight: this is a greenfield surface with zero in-repo precedent to preserve (see Codebase Reality Check), and NestJS's own primitives (`ValidationPipe`, `Guards`, `@nestjs/throttler`) map directly onto this RFC's concrete needs (schema validation, signature-verification auth, rate limiting) as first-class framework features rather than assembled plugins — a real win when the team already knows how to use them correctly. Not a rejected option; a genuine tradeoff resolved in NestJS's favor by familiarity. |
| **Fastify** — see Alternative Stack A | Team has no stated familiarity with Fastify. | TypeScript-first, built-in JSON Schema request/response validation, mature plugin ecosystem for rate limiting (`@fastify/rate-limit`) and auth hooks, lean core dependency footprint — the lightest-weight option of the four and the closest technical match to `parseSubmission`'s allowlist discipline (a request that doesn't match the declared schema is rejected before a handler ever sees it) and to this repo's plain-function bias. Still a fully viable, honestly-competitive choice on technical merits alone — see Alternative Stack A for its complete tradeoff writeup. |
| **Hono** | Team has no stated familiarity with Hono. | Ultra-lightweight, runtime-portable (Node, Bun, Deno, Cloudflare Workers, edge). Its edge-portability is a real advantage only if the eventual hosting target is edge/serverless — but hosting is explicitly deferred and the packaging assumption here is Docker containers running a long-lived Node process, where Hono's portability advantage is not decisive. Its schema-validation and plugin ecosystem for stateful concerns (rate limiting, DB pooling) are less mature than Fastify's or NestJS's for this specific containerized-Node shape. |
| **Express** | Team has no stated familiarity called out; Express familiarity is broadly common industry-wide but not cited as a specific team factor here. | Most established, largest ecosystem — but no native schema validation (would need a separate library bolted on), callback-era middleware patterns, and a heavier implicit dependency surface once you add the validation/rate-limit libraries Fastify or NestJS ship equivalents of by convention. Weaker fit for a repo culture that already treats "validate then rebuild the object field-by-field" as a first-class discipline (`parseSubmission`), not a bolt-on. |

### Axis 2 — Data Store (multi-tenant + immutable time-series queries)

| Option | Fit |
|---|---|
| **PostgreSQL** | Relational, mature, runs identically in any Docker environment (no provider lock-in). JSONB columns hold the existing `dimensions[]` / `frameworkMapping` payload shapes as-is (same shape `parseSubmission` already validates) without a schema migration every time a new dimension is added. Native row-level security and straightforward `account_id`/`visibility` columns support public/private tenant isolation as a second, DB-enforced layer beneath the API's own authz check — mirroring the leaderboard's existing two-independent-layers security model (allowlist parsing at input, `.textContent`-only at output). Append-only `submissions` table (insert-only, no update/delete) directly implements "historical time-series, not just latest." |
| **TimescaleDB** (Postgres extension) | Purpose-built time-series features (continuous aggregates, retention policies) on top of Postgres — genuinely useful once trend-query volume justifies it, but adds an extension-specific operational dependency before it's needed. Deferred as a possible later optimization on top of the recommended plain-Postgres schema, not a v1 requirement. |
| **SQLite** | Simplest possible operational footprint, closest in spirit to this repo's minimal-dependency bias — but single-writer file-lock semantics make it a poor fit for a public multi-tenant service with concurrent writes across scaled-out API containers, and it has no native row-level tenant isolation, pushing all public/private enforcement into application code with no DB-layer backstop. That single-layer-of-defense shape is exactly what the leaderboard's two-independent-layers security model argues against. |
| **MongoDB** | Flexible schema, easy to start with — but this repo's dominant convention (`parseSubmission`) is the opposite of "flexible schema, validate what you can": it insists on a hard allowlist of exactly 7 fields with everything else discarded. A document store's natural flexibility works against, not with, that established discipline, and MongoDB's multi-tenant/relational integrity story (account -> keys -> repos -> submissions) is weaker than Postgres foreign keys for this specific relationship shape. |

### Axis 3 — Signature Scheme for the Verified Tier

| Option | Fit |
|---|---|
| **Ed25519 asymmetric keypairs** | Submitter generates and holds a private key; registers only the public key with their account (identity/key registry component). Submissions are signed client-side over a canonical JSON payload; the API verifies against the registered public key and never sees or stores the private key. This is what makes the tier genuinely "verifiable" — the design file's own error-handling rule ("an invalid signature is rejected outright — never silently downgraded to unverified") only makes sense with asymmetric verification, since only asymmetric signatures let a third party (not just this API) verify the claim later. Industry-standard for this exact use case (SSH, TUF, Sigstore/cosign all use Ed25519 or equivalent asymmetric signing for attestations). |
| **HMAC shared-secret signing** | Simpler to implement (one shared secret per account instead of a keypair) — but the secret must be distributed to the submitter and stored server-side, so a leak on *either* side compromises the tier's trust guarantee, and only the API itself (holder of the secret) can verify a signature, not any third party. Weaker "verifiable attestation" story than the phrase in `ARCHITECTURE.md` implies. |
| **Sigstore/cosign-style keyless (OIDC-based) signing** | The most sophisticated option, aligned with the broader in-toto/SLSA supply-chain-attestation ecosystem — but requires either standing up Fulcio/Rekor infrastructure or depending on the public Sigstore instance, a significant operational dependency for a v1 verified tier. Worth revisiting once the verified tier has real adoption; not justified for the first version. |

### Axis 4 — Local Dev Environment

All stacks below assume a `docker-compose.yml` with an `api` service (the Node/NestJS container for
the recommendation, or Node/Fastify or Node/Hono for the alternatives, built from a `Dockerfile`
alongside the new service's source), a `db` service (official `postgres` image, or `postgres` +
`sqlite` swap for Stack C), and a one-shot `migrate` service/entrypoint that runs schema migrations
before `api` starts. This mirrors the existing repo's `nvm use 22.14.0` + `npm run build`
local-dev pattern (see `leaderboard/README.md` "Usage (local)") by keeping `npm run dev` (inside
the container, `nest start --watch` for the recommended stack) as the actual entrypoint, with
docker-compose only responsible for wiring the API container to a real Postgres instance instead
of a mock.

### Axis 5 — ORM / Query Layer (added in this amendment)

The original RFC's ORM choice (Drizzle over Prisma) was decided implicitly inside the "Recommended
Stack" rationale rather than compared on its own axis. This amendment gives it a proper
comparison table, both to fix that gap and because NestJS's idiomatic ORM pairing differs from
Fastify's — the choice needs re-deriving, not carrying over by default.

| Option | Fit |
|---|---|
| **TypeORM** | NestJS's officially blessed ORM integration (`@nestjs/typeorm` module, documented in NestJS's own official recipes). Decorator-based `@Entity()` classes are idiomatic within NestJS's existing DI/decorator architecture, so the team-familiarity advantage that justified choosing NestJS in Axis 1 extends naturally to the data layer too, not just routing. No codegen binary or generation step — it uses `reflect-metadata`, which NestJS's DI container already depends on, so this doesn't introduce a wholly new dependency category, only uses one already present. Native migration tooling. Tradeoff: still a heavier abstraction (Active Record and Data Mapper patterns, decorator-based entity classes) than Drizzle's plain-function/SQL-close style, so it weighs less strongly on this repo's minimal-dependency bias than the original Drizzle recommendation did — an explicit, accepted tradeoff in exchange for the team-familiarity/idiomatic-NestJS benefit, not an oversight. |
| **Prisma** | Excellent DX and strong generated types — but requires a separate `prisma generate` codegen step and a compiled query-engine binary shipped alongside the app. This was the decisive reason Prisma was rejected in the original RFC regardless of API framework, and that reasoning is framework-independent: it still applies here unchanged by the NestJS swap. Rejected for the same reason as before. |
| **Drizzle** | Stays closest to this repo's `"dependencies": {}` minimal-footprint bias (no codegen, SQL-close, plain TypeScript objects/functions) — but has no official NestJS integration module; using it inside NestJS means writing custom providers/factories to make Drizzle instances injectable via Nest's DI container, working against the class/decorator idiom the rest of the NestJS choice leans into. A legitimate alternative if the minimal-dependency bias is weighted higher than idiomatic-NestJS integration — this is exactly the pairing used in Alternative Stack A (Fastify + Drizzle), where it fits more naturally alongside a non-DI framework. |
| **MikroORM** | Also has first-class NestJS integration (`@mikro-orm/nestjs`) and decorator-based entities similar to TypeORM — a reasonable alternative, but a smaller community/ecosystem within the NestJS world specifically compared to TypeORM's status as the framework's most-documented, most-used ORM pairing. Not chosen over TypeORM for this v1 since no other factor strongly favors it over the more established option. |

**Recommendation for Axis 5: TypeORM**, for the reasons in its row above — it is the only option
that extends Axis 1's familiarity/idiomatic-integration rationale all the way to the data layer
while still avoiding the codegen-binary dependency that ruled out Prisma.

---

## Recommended Stack — NestJS + PostgreSQL + TypeORM + Ed25519

**Recommendation:** NestJS (API framework) + PostgreSQL (data store) + TypeORM (data layer, via
`@nestjs/typeorm`) + Ed25519 asymmetric signatures (verified tier), packaged as Docker containers
with a docker-compose-based local dev environment.

**Rationale:** This combination leads with the team's existing NestJS familiarity — a concrete
delivery-speed and correctness factor the original Fastify-based recommendation never weighed —
while still satisfying the other three axes on their own technical merits: an append-only
relational store (Postgres) that gives DB-enforced tenant isolation as a second defense layer
beneath the API's own authz checks (mirroring the leaderboard's existing two-independent-layers
security model), asymmetric signing (Ed25519) that actually satisfies `ARCHITECTURE.md`'s
"signed/verifiable attestations" phrase rather than a weaker HMAC approximation, and a data layer
(TypeORM) chosen specifically because it is NestJS's idiomatic, officially-integrated ORM and still
avoids the codegen-binary dependency that ruled out Prisma (see Axis 5). This does trade away some
of the minimal-dependency ceiling the original Fastify + Drizzle recommendation offered — NestJS's
DI container/module system and TypeORM's decorator-based entities are a larger dependency and
abstraction surface than Fastify + Drizzle's plain-function style. That tradeoff is made
deliberately: team familiarity reduces real-world implementation risk on Phase 3/4 (signature
verification, tenant isolation) — this RFC's own highest-risk, `HITL`-classified phases — more than
the marginal dependency-surface reduction would have helped an unfamiliar team. Fastify + Drizzle
remains fully documented as Alternative Stack A below for anyone who weighs the minimal-dependency
bias more heavily than familiarity.

**Concrete request-validation carryover:** the Submission API's inbound payload should be
validated via a NestJS DTO class with `class-validator` decorators, registered behind a global
`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` — this is NestJS's direct
equivalent of Fastify's `additionalProperties: false` (anything outside the 7 existing submission
fields plus a signature/tenant envelope is rejected before the handler runs). The service/handler
layer must still construct the row to insert field-by-field from the validated DTO — never a raw
object spread into the TypeORM repository's `save`/`insert` call — directly continuing
`parseSubmission`'s "rebuild the object field-by-field, never spread the raw parsed JSON" rule and
its `__proto__`/`constructor`/`prototype` key-rejection discipline wherever a submission-controlled
string (e.g. a `dimensions[].id`) is later used as an object key.

## Alternative Stacks (real, honestly-assessed alternatives — not rejected as non-starters)

### Stack A — Fastify + PostgreSQL + Drizzle + Ed25519 (this RFC's original recommendation)

Same data store and signature scheme as the current recommendation; differs on API framework and
ORM. This was this RFC's recommended stack prior to this amendment, and remains a fully viable,
technically-competitive choice — it is superseded here specifically by the team-familiarity factor
introduced in this amendment, not by any technical deficiency discovered in it.

**Tradeoffs vs. the current recommendation:**
- **In its favor:** lighter core dependency footprint (Fastify's plugin model is leaner than
  NestJS's DI/module system), and Drizzle's plain-function/SQL-close style is the closer technical
  match to this repo's existing bias toward small, composable, individually-testable pure functions
  (`buildLeaderboard`, `parseSubmission`) — Fastify + Drizzle stays closer to the repo's status quo
  coding style than NestJS + TypeORM does. Schema-first request validation (Fastify's built-in JSON
  Schema) is also a very close philosophical match to `parseSubmission`'s allowlist discipline.
- **Against it:** the team has no stated familiarity with Fastify or Drizzle, unlike NestJS. On a
  first, security-relevant live surface (signature verification, tenant isolation are this RFC's
  own highest-risk, `HITL`-classified phases), unfamiliar tooling raises real implementation-mistake
  and code-review-friction risk that a smaller dependency footprint does not offset by itself.
- **When to reconsider this stack instead:** if the team's NestJS familiarity turns out to be
  weaker than represented, or if a future phase reveals NestJS's DI/module overhead is a genuine
  velocity drag rather than a net-neutral structural cost, Stack A is the documented fallback — not
  a rebuild from scratch, since Axis 2/3/4's decisions (Postgres, Ed25519, docker-compose shape)
  are identical either way.

### Stack B — Hono + PostgreSQL + Ed25519

Same data store and signature scheme as the recommendation; differs only on API framework.
**Drawback:** Hono's core advantage is multi-runtime/edge portability, which is not decisive given
the containerized, long-lived-Node-process packaging assumption of this RFC — hosting is
explicitly deferred, but the packaging shape (Docker, not edge functions) is already fixed. Hono's
ecosystem for stateful, long-running-process concerns this service needs from day one (DB
connection pooling, rate limiting, structured request lifecycle hooks) is less mature than
Fastify's or NestJS's for this specific shape, and — like Fastify — the team has no stated
familiarity with it either, so it carries the same familiarity gap as Stack A without that stack's
closer-to-status-quo coding-style benefit. Worth reconsidering only if a future hosting decision
moves toward edge/serverless — not a reason to choose it now.

### Stack C — Express + SQLite + HMAC shared-secret signing

**Drawback:** the fastest stack to stand up, but weakest on every axis that matters for a public
multi-tenant service: SQLite's single-writer semantics don't scale to concurrent multi-tenant
writes across multiple API containers, it has no DB-layer tenant isolation (pushing public/private
enforcement into a single layer of application code, unlike the leaderboard's two-independent-
layers precedent), and HMAC signing produces a weaker "verifiable by anyone" attestation than
asymmetric signing while adding its own shared-secret-distribution operational burden. This stack
is the technology-level echo of the already-rejected "attestation-verify-only, minimize the diff"
approach from the design phase — it optimizes for fastest-to-build over product ceiling, which the
user already explicitly decided against at the approach level (see "Rejected Alternatives at the
Approach Level" below). Rejected for the same reason, one level down the stack.

## Rejected Alternatives at the Approach Level (carried forward from the approved design)

These were decided during the brainstorming/design pass, not reopened here — restated for a
complete RFC record with the exact reasoning used:

- **Attestation-verification-only service, static leaderboard left untouched.** Smaller
  engineering diff than Option A, but caps the product at "verify one claim at a time" rather than
  becoming a real live, queryable platform comparable to OpenSSF Scorecard / Socket.dev / Snyk
  Advisor. Rejected because the user explicitly chose to optimize for long-term product ceiling
  over minimizing the engineering diff.
- **Fully external managed BaaS (Supabase/Firebase-style).** Fastest to stand up of all options
  considered — but the weakest fit with this repo's established pattern of owning its trust model
  explicitly in first-party code (see the leaderboard's allowlist-parser decision doc,
  `docs/2026-08-11-harness-audit-leaderboard-submission-allowlist-decision.md` in the sibling
  ai-craft monorepo, cited via `leaderboard/README.md`) and the least naturally suited of the
  considered options to "tiered public/private scoring" as a first-class, self-owned concept rather
  than a BaaS vendor's generic row-level-security feature bolted on after the fact.

---

## Data Model Sketch (illustrative — finalized at execution-plan time)

Four tables, matching the design's four components:

- `accounts` — `id`, `org_name`, `created_at`. One row per submitting organization.
- `signing_keys` — `id`, `account_id` (FK), `public_key`, `key_id`, `created_at`,
  `revoked_at` (nullable). The identity/key registry for the verified tier — never stores a
  private key.
- `repos` — `id`, `account_id` (FK), `repo_id` (e.g. `"acme/widgets"`, matching the leaderboard's
  existing `repoId` convention), `visibility` (`public` | `private`).
- `submissions` — `id`, `repo_id` (FK), `score`, `level` (jsonb), `dimensions` (jsonb),
  `framework_mapping` (jsonb), `commit_sha`, `scanned_at`, `verified` (boolean), `signature`
  (nullable), `submitted_at`. **Insert-only** — no `UPDATE`/`DELETE` path, directly implementing
  "every submission stored immutably, not just latest."

An optional `rejected_submissions` audit table (`payload_hash`, `reason`, `rejected_at`) is worth
carrying over from the leaderboard's "skipped with a reason, never silently dropped" philosophy —
for a live API this translates to a structured 4xx error response *and* an optional audit-log
insert for observability (e.g. tracking repeated malformed submissions from one source), decided
at execution-plan time.

## Security / Trust-Boundary Mapping to Existing Repo Conventions

| Leaderboard precedent | Live backend equivalent |
|---|---|
| Allowlist parsing (`parseSubmission`): exactly 7 fields, rebuilt field-by-field, never spread raw JSON | NestJS DTO + `class-validator` with a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, plus field-by-field row construction before the TypeORM repository `save`/`insert` call |
| `__proto__`/`constructor`/`prototype` key rejection wherever a submission string becomes an object key | Same rejection rule applied to `dimensions[].id` and `frameworkMapping` keys in the Submission API |
| PR-based trust boundary (human review before merge) | Signature verification (verified tier) + rate limiting + schema validation stand in for human review on the live write path, since there is no PR step for a live API |
| `.textContent`-only rendering (defense-in-depth even after acceptance) | Query API responses are JSON only (no server-rendered HTML in this surface), removing the injection vector class entirely rather than needing an output-encoding equivalent — worth re-verifying if/when a live embeddable badge (fast-follow, out of scope here) renders HTML client-side |
| "Skipped with a reason, never silently dropped" (`buildLeaderboard`) | Malformed/rate-limited submissions rejected with a structured reason in the HTTP response body, never silently accepted-but-ignored or silently 200'd |
| Invalid signature never silently downgraded to "unverified" | Same rule, stated explicitly in the design file's Error Handling section — carried forward unchanged into this stack's NestJS signature-verification `Guard` |

---

## Risks and Mitigations

| Risk | P | I | Score | Mitigation |
|---|---|---|---|---|
| Public write endpoint becomes a spam/abuse vector once no PR-review gate exists | 4 | 4 | 16 | Rate limiting at the API layer (`@nestjs/throttler`) plus the verified tier's signature check for any submission wanting elevated trust; basic-tier submissions always carry a visible "self-reported" badge, same as today's leaderboard |
| Multi-tenant data leak (private repo score visible to another account) | 2 | 5 | 10 | Two independent layers: API-level authz check on every query *and* a DB-level `account_id`/`visibility` filter (Postgres row-level security or an equivalent mandatory `WHERE` clause helper), mirroring the leaderboard's two-independent-layers precedent |
| Private-key compromise on the submitter's side undermines a "verified" badge's meaning | 2 | 4 | 8 | Ed25519 (not HMAC) keeps the private key entirely client-side, never transmitted or stored server-side; `signing_keys.revoked_at` lets an account revoke a compromised key without waiting on this service's own release cycle |
| Schema drift between `harnesslens`' `Report` shape and the Submission API's accepted schema | 3 | 3 | 9 | The Submission API's validation schema (NestJS DTO + `class-validator` decorators) is derived from and versioned alongside the same `dimensions[]`/`frameworkMapping` shapes already validated by `parseSubmission` today, keeping one canonical schema source instead of two independently-drifting ones |
| Building this before the underlying `@ai-craft/harnesslens` package itself is public leaves the live API effectively unreachable by outside submitters (same limitation `leaderboard/README.md` already documents for the static leaderboard's submit workflow) | 3 | 2 | 6 | Explicitly out of scope for this RFC to resolve; flag as a known adoption blocker for the execution-plan stage, not a backend architecture problem |

---

## Post-Approval Phased Implementation Roadmap

*(Illustrative only — not to be executed from this RFC. A dedicated `execution_plan` with full
TDD task breakdown must be created after the user approves a direction.)*

- **Phase 0 — Schema & local dev environment**: `docker-compose.yml`, Postgres service, TypeORM
  migration for the four tables above, `npm run dev` (`nest start --watch`) inside the `api`
  container. Exit: `docker compose up` produces a running API container connected to a running
  Postgres container with migrations applied.
- **Phase 1 — Submission API tracer bullet (basic tier only)**: one POST endpoint, NestJS DTO +
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, field-by-field row
  construction, insert into `submissions` via the TypeORM repository. No signature verification
  yet. Exit: a valid basic-tier submission persists and a malformed one is rejected with a
  structured reason, not silently dropped.
- **Phase 2 — Query API (public tier only)**: read endpoints for current + historical scores,
  scoped to `visibility = 'public'`. Exit: a public submission is queryable immediately after
  insert; a private submission is not returned to an unauthenticated caller.
- **Phase 3 — Verified tier**: `signing_keys` registry endpoints, Ed25519 signature verification
  on submission, `verified` flag set only on a valid signature, invalid signatures rejected
  outright. Exit: a signed submission from a registered key is marked verified; a submission with
  a bad signature is rejected, not marked unverified-and-accepted.
- **Phase 4 — Private tier + authenticated queries**: account auth on the Query API, DB-level
  visibility filter as the second defense layer, historical/trend endpoints. Exit: an
  authenticated account can query its own private-repo history; an unauthenticated or
  wrong-account caller cannot.

## Acceptance Checks (for this RFC, not the eventual implementation)

- This document is saved at `docs/plans/2026-08-13-live-hosted-backend-plan.md`.
- It presents at least two concrete, comparable technology stacks with named drawbacks (Stack A,
  Stack B, Stack C), plus a clear recommendation with stated rationale (Recommended Stack). Stack A
  (Fastify + PostgreSQL + Drizzle + Ed25519) is this RFC's prior recommendation, retained as a
  real, honestly-assessed alternative — not deleted or turned into a strawman — per this
  amendment's explicit requirement.
- It grounds every recommendation in a specific, cited repo convention (`parseSubmission`,
  `buildLeaderboard`, the leaderboard's two-independent-layers security model, its PR-based trust
  boundary) rather than generic pros/cons.
- It stays scoped to item 1 of `ARCHITECTURE.md`'s "Future direction" list and does not modify or
  propose modifying `src/`, `action/`, or `leaderboard/`.
- The user reviews this RFC and either approves the Recommended Stack, chooses an alternative, or
  requests changes before any `execution_plan` is created.

## Open Questions for a Future Pass (non-blocking, explicitly deferred — not open decisions of this RFC)

- Hosting/cloud provider selection (explicitly deferred per the approved design).
- Exact rate-limit thresholds and abuse-detection policy for the basic tier.
- Whether `rejected_submissions` audit logging ships in v1 or a later phase.
- Embeddable live badge rendering off the Query API (fast-follow, not core RFC scope).
- Whether/when to layer TimescaleDB on top of the recommended plain-Postgres schema once trend-
  query volume justifies it.
