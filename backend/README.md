# harnesslens backend

Live, multi-tenant scoring API + Postgres backend for harnesslens (item 1 of
[`ARCHITECTURE.md`](../ARCHITECTURE.md)'s "Future direction" list). A standalone NestJS + Postgres
+ TypeORM package that never modifies `src/`, `action/`, or `leaderboard/`. See
[`docs/plans/2026-08-13-live-hosted-backend-design.md`](../docs/plans/2026-08-13-live-hosted-backend-design.md)
and
[`docs/plans/2026-08-13-live-hosted-backend-plan.md`](../docs/plans/2026-08-13-live-hosted-backend-plan.md)
for the full design/RFC.

> **Hosting is not yet decided.** No cloud/hosting provider has been chosen or configured. This
> package only defines the application and its local/container packaging; deploying it to a real
> environment is an explicit, deferred fast-follow.

## Local dev

```bash
cd backend
docker compose up -d --wait
curl -sf http://localhost:3000/health/db   # {"status":"ok"}
docker compose down -v
```

`docker compose up` builds and runs three services from `docker-compose.yml`:

- `db` — `postgres:16-alpine`, healthchecked via `pg_isready`.
- `migrate` — one-shot; runs `npm run migration:run` against `db`, then exits.
- `api` — the NestJS app, built from `Dockerfile`'s `dev` stage (`npm run start:dev`, watch mode,
  `./src` bind-mounted), starts only after `migrate` exits successfully. Listens on `:3000`.

`docker-compose.yml`'s `api`/`migrate` services pin `build.target: dev` explicitly, so they always
build the watch-mode dev stage regardless of what other stages exist in `Dockerfile` (see
"Container image" below).

Environment variables (see `.env.example`):

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`). |
| `DATABASE_URL` | Postgres connection string. Required — the app fails fast at startup if unset. |
| `SUBMIT_RATE_LIMIT_PER_MIN` | `POST /submissions` rate-limit threshold per IP per 60s window (default `30`). |

## Container image

`Dockerfile` is multi-stage, stages defined in this order:

1. `dev` — watch-mode dev container (`npm run start:dev`), used by `docker-compose.yml`.
2. `build` — `npm ci && npm run build`, produces `dist/`.
3. `runtime` — production-shaped: `npm ci --omit=dev`, copies `dist/` from `build`, runs as the
   image's built-in non-root `node` user, `CMD ["node", "dist/main.js"]`. No bind mounts, no dev
   dependencies.

> **Always pass `--target` explicitly.** A bare `docker build .` (no `--target`) silently resolves
> to the *last* stage defined in the Dockerfile — currently `runtime`, not `dev` — because Docker
> builds the final stage by default when none is named. `docker-compose.yml`'s `api`/`migrate`
> services already pin `build.target: dev` for this reason (see "Local dev" above); when building
> by hand, always name the stage you want: `docker build --target dev .` for the watch-mode dev
> image, `docker build --target runtime .` for the production image. Never rely on the default.

Build and run the production image standalone:

```bash
docker build --target runtime -t harnesslens-backend .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://harnesslens:harnesslens@<reachable-postgres-host>:5432/harnesslens \
  -e PORT=3000 \
  harnesslens-backend
```

## Running tests

Three tiers, in increasing order of what they need:

| Tier | Command | Needs |
|---|---|---|
| Unit | `npm test` | Nothing — pure Vitest, no DB. |
| Integration | `npm run test:integration` | Docker (each spec starts its own ephemeral `@testcontainers/postgresql` instance). Runs everything under `test/e2e/**/*.e2e-spec.ts` and `test/integration/**/*.int-spec.ts`. |
| Live proof | `./scripts/run-live-proof.sh` | Docker + docker-compose. Brings up the full `docker-compose.yml` stack (fresh Postgres volume, freshly built `dev`-stage image), waits for `/health` to respond, runs the full `test/e2e` suite, then always tears the stack down (`docker compose down -v`), even on failure. |

`npm run typecheck` and `npm run build` (`tsc --noEmit` / `nest build`) have no runtime
dependencies.

The full proof-scenario list this exercises is documented in
`test/live/manifest.json` and the execution plan's Live Verification Strategy section: basic-tier
submission golden/negative paths, `__proto__`-dimension rejection, verified-tier signature
golden/negative paths, private-tier ownership golden/negative paths, and rate-limit recovery.

> **Known gap:** `test/e2e/*.e2e-spec.ts` specs each provision their own throwaway Testcontainers
> Postgres in `beforeAll` and compile the NestJS module in-process — they do not route HTTP
> requests through the `docker-compose.yml` `api` container itself. `run-live-proof.sh` therefore
> proves two things together (the compose stack boots correctly — healthchecks, migration-before-
> api ordering — *and* the full behavioral suite passes) but does not yet prove that traffic
> flowing through the compose-built `api` container specifically exercises this behavior end to
> end. Wiring the e2e suite to run against the already-running compose `api` container over HTTP
> is a reasonable fast-follow, not done here to avoid rewriting every existing e2e spec file
> outside this phase's scope.

## Trust-tier model (as shipped)

Two independent axes, both live:

**Submission trust tier** (set per-submission, on `POST /submissions`):
- **basic** (default) — unsigned, self-reported. Any `repoId` never seen before auto-provisions an
  `accounts` row (`org_name` = the `org` segment of `repoId`) and a `repos` row
  (`visibility: 'public'`) — no pre-registration required, mirroring the existing leaderboard's
  self-reported model. Returned as `verified: false`.
- **verified** — the same `POST /submissions` payload, additionally carrying `keyId` + `signature`.
  The server reconstructs the canonical payload itself (see "Canonical payload contract" below)
  and verifies it with Ed25519 against a previously registered, non-revoked signing key for that
  `keyId`. An invalid signature is rejected outright (400 + `rejected_submissions` audit row) —
  never silently accepted as unsigned. Returned as `verified: true`.

**Repo visibility tier** (set per-repo, via `PATCH /accounts/:accountId/repos/:repoId/visibility`):
- **public** (default) — readable by anyone via `GET /repos`, `GET /repos/:org/:repo`,
  `GET /repos/:org/:repo/history`.
- **private** — readable only by the owning account's holder, authenticated via
  `Authorization: Bearer <apiKey>`. Two independent isolation layers enforce this: (a) every
  controller path checks the authenticated account owns the resource before returning it, and
  (b) `QueryService.getPrivateHistory` always requires and applies an `accountId` filter in its
  `WHERE` clause — there is no code path that queries private submissions without it. A private
  repo and a repo that never existed return an identical 404 (never 403, never distinguishable).

**Account authentication:** account creation (`POST /accounts`) returns a raw bearer API key
exactly once; only its SHA-256 hash is ever persisted. That key authenticates
`Authorization: Bearer <key>` on all account-scoped write/read endpoints (signing-key
registration/revocation, repo visibility toggling, private-tier queries). It is separate from
Ed25519 payload signing: the API key authenticates *the account holder*; the Ed25519 signature
authenticates *an individual submission's verified-tier claim*.

### Known v1 limitations (not silently hidden)

- **No rate limiting on `POST /accounts`, signing-key, or repo-visibility endpoints** — only
  `POST /submissions` is guarded by `@nestjs/throttler` (`ThrottlerGuard`). Account/signing-key/
  visibility endpoints are lower-volume, authenticated-write paths, but are not yet rate-limited.
- **No endpoint to list/discover a repo's internal UUID.** `PATCH
  /accounts/:accountId/repos/:repoId/visibility` takes the repo's internal UUID primary key, not
  its `org/repo` string — there is currently no `GET /accounts/:accountId/repos` (or similar)
  endpoint to look that UUID up. An account holder who only knows their `repoId` string (e.g. from
  the auto-provisioning flow) currently has no API-exposed way to discover the UUID they need for
  the visibility-toggle call.
- **Account/repo org-squatting**: a never-seen `org_name` can be auto-provisioned by *any* basic-
  tier submission before the real org ever calls `POST /accounts`, which then 409s on that
  `org_name`. Not solved here — see the execution plan's Risks table.
- **Hosting/cloud provider is not chosen.** This package defines the app and its local/container
  packaging only.

## Canonical payload contract

For a future client SDK implementing verified-tier signing. The server never accepts a
client-supplied "canonical string" — it always rebuilds this exact string itself from the
already-validated submission fields before verifying a signature against it
(`src/signing/canonical-payload.ts`):

```ts
interface CanonicalSubmissionFields {
  repoId: string;
  score: number;
  level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
  frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  commitSha: string;
  scannedAt: string;
}
```

`buildCanonicalPayload(fields)` produces a single `JSON.stringify(...)` of an object with exactly
this key order — `repoId, score, level, dimensions, frameworkMapping, commitSha, scannedAt` — with
`frameworkMapping`'s own keys sorted alphabetically first. The same logical payload always produces
a byte-identical canonical string, which is what gets Ed25519-signed:

- **Keys:** exchanged as base64-encoded raw 32-byte Ed25519 public keys (registered via `POST
  /accounts/:accountId/signing-keys`) and base64-encoded raw 64-byte signatures (submitted as
  `signature` on `POST /submissions`, alongside the registered key's `keyId`).
- **Signing:** `crypto.sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKeyObject)` on the
  client, base64-encoded.
- **Verification (server, `src/signing/ed25519.ts`):** the raw public key is wrapped into a JWK
  (`{ kty: 'OKP', crv: 'Ed25519', x: <base64url> }`) and verified with Node's native
  `crypto.verify` — no third-party signing library on either side is required, but a client SDK is
  free to use one as long as it produces a standard raw Ed25519 signature over the exact canonical
  string above.

## Out of scope (unchanged from the RFC/execution plan)

- Choosing/configuring a hosting or cloud provider.
- CI workflow wiring (`.github/workflows/*.yml`) for this package.
- A client SDK for submitters (this README documents the contract; building the SDK is separate).
- Splitting the Submission API and Query API into separately deployable services.
- Postgres row-level security for tenant isolation (mandatory-`WHERE`-clause scoping is used
  instead — see the execution plan's Alternatives section).
