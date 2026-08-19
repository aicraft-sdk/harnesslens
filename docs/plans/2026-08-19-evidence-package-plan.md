# Signed Evidence Package — Execution Plan

> **For Claude:** REQUIRED: Follow this plan task-by-task using TDD.
> **Design:** See `docs/plans/2026-08-19-evidence-package-design.md` for the full, user-approved
> specification (Purpose, Users, Success Criteria, Constraints, Out of Scope, Approach,
> Architecture, Data Flow, Error Handling, Testing Strategy, Questions Resolved). This plan turns
> that design's 5 approach steps into ordered, TDD-executable phases. It does not re-litigate any
> settled direction from the design.

**Goal:** Extend the existing live-backend Ed25519 "verified" submission path end-to-end so a repo
owner can generate a signing key, produce a per-check signed evidence package, submit it, and let
anyone independently verify it — without harnesslens ever computing or claiming a
certification/pass-fail verdict of its own.

**Architecture:** Backend-first, then CLI. Phases 1–3 extend `backend/` (already-shipped
NestJS + PostgreSQL + TypeORM + Ed25519 live backend, item 1 of `ARCHITECTURE.md`'s roadmap) with
an optional `checks[]` field on the canonical signed payload, its storage, and a new
`GET /submissions/:id/evidence` read surface. Phases 4–6 build the CLI's **first-ever** network/
signing capability (`src/keys.ts`, `src/canonical-payload.ts`, `src/evidence-package.ts`,
`src/verify-package.ts`), reusing `node:crypto` only (zero new runtime dependencies) and Node 22's
built-in `fetch`. The CLI and backend are separate, unlinked npm packages (no workspace, no shared
import) — cross-package parity is enforced by a byte-exact golden-string fixture test on each side,
not a shared module.

**Tech Stack:** Backend: NestJS 11 + TypeORM 0.3 + PostgreSQL + `class-validator`/
`class-transformer` + `node:crypto` Ed25519 (all already in `backend/package.json`, no new
dependencies added by this plan). CLI: `node:crypto`, `node:fs`, `node:os`, `node:path`, built-in
`fetch` — `"dependencies": {}` stays empty.

**Prerequisites:** The live backend (item 1) is merged to `main` (commit `025a882`) and its
`verified`-tier Ed25519 signing/verification path, `POST /accounts`, `POST/DELETE
/accounts/:accountId/signing-keys`, and `POST /submissions` are already shipped and working. Local
dev requires `cd backend && docker compose up -d --wait` for integration/e2e/migration work.

**Durable Decisions:**
1. **Canonical payload field order** (extends `backend/src/signing/canonical-payload.ts`):
   `repoId, score, level, dimensions, checks, frameworkMapping, commitSha, scannedAt` — `checks`
   inserted immediately after `dimensions`.
2. **Backward compatibility is load-bearing, not optional.** When a submission omits `checks[]`
   entirely, `buildCanonicalPayload` must omit the `checks` key from the JSON string outright (not
   emit `checks: null`) so it is **byte-identical** to today's pre-extension canonical string.
   Every already-registered verified-tier signer that never adopts `checks[]` must keep working
   with zero re-signing. This is enforced by a hardcoded golden-string regression test in Phase 1
   (see Task 1.1).
3. **`checks[]` DTO shape** (mirrors `dimensions[]`'s existing per-field validation pattern,
   design's explicit exclusion): `{ id, dimension, title, points, earned, passed, evidence }` —
   `remediation` and `docsUrl` are never included (redundant with the public checks registry, per
   design).
4. **`checks[].id` gets the same two-layer dangerous-key defense as `dimensions[].id`:**
   `SAFE_ID_RE` at the DTO layer (`create-submission.dto.ts`) *and* `isDangerousKey` fail-closed at
   the service layer (`submissions.service.ts`) — this codebase's existing pattern keeps both
   layers even though either alone would catch `__proto__`/`constructor`/`prototype`; do not
   simplify this to one layer.
5. **Storage:** `submissions.checks` is a nullable `jsonb` column (new migration), mirroring
   `signature`/`keyId`'s existing optional-field-nullable-column pattern, not the mandatory
   non-null `dimensions`/`level` columns.
6. **`GET /submissions/:id/evidence` is backed by a new, small `SubmissionEvidenceService`**
   (`backend/src/submissions/submission-evidence.service.ts`), not folded into the existing
   `SubmissionsService`. Reason: `SubmissionsService`'s constructor is instantiated directly (no DI
   container) 8+ times across `submissions.service.spec.ts`; adding a 4th constructor dependency
   there would force editing all 8 call sites for an unrelated read path. A separate service
   mirrors this codebase's own existing `QueryService`/`SubmissionsService` split (write vs. read
   concerns already live in different services) and keeps blast radius to the new file only. The
   route itself still lives on `submissions.controller.ts`, per the design's Components list.
7. **`GET /submissions/:id/evidence` respects the existing private/public repo-visibility model.**
   The design does not call this out explicitly, but leaking a private repo's full per-check
   evidence to an unauthenticated caller would be a direct regression of the already-shipped,
   twice-hardened tenant-isolation model (`docs/decisions/2026-08-14-verified-tier-signing-key-trust-boundary-decision.md`
   and the Phase-4 private-tier work). The new endpoint reuses `OptionalApiKeyGuard` and the same
   404-not-403, indistinguishable-from-never-existed contract as `QueryController.getOne`.
8. **`GET /submissions/:id/evidence` validates its `:id` path param is a UUID before querying,
   returning 404 (not 500) for a malformed id.** This mirrors a HIGH bug already found and fixed
   once in this exact codebase (Phase 4, live-hosted-backend build: "malformed-UUID repoId crashes
   to 500") — the same crash class is trivially reachable here (`findOne({ where: { id } })`
   against a non-UUID string throws a Postgres `invalid input syntax for type uuid` error) unless
   guarded.
9. **CLI `submit` always signs.** This plan does not add an unsigned/basic-tier submission path
   to the CLI — the design's whole purpose is the *signed* evidence package (unsigned self-report
   is already covered by the existing, separate leaderboard manual-PR flow). `harnesslens submit`
   requires `--sign`; omitting it is a fail-loud usage error, never a silent unsigned fallback.
10. **CLI key registration is a printed suggestion, not automated.** `harnesslens keygen` never
    calls `POST /accounts/:accountId/signing-keys` itself (that would require the CLI to also
    manage `accountId`/`apiKey` inputs, which is out of this design's approach). It prints the
    base64 public key and a copy-pasteable `curl` command; the user registers it manually and
    passes the returned `keyId` to `harnesslens submit --sign --key-id <uuid>`.
11. **CLI `--repo-id`, `--commit-sha` are explicit required flags on `submit`**, not auto-detected
    via a `git` shell-out. No `child_process`/git-shelling precedent exists anywhere in this repo
    (`leaderboard/`'s manual-PR flow requires the submitter to supply `commitSha` themselves too);
    adding one would be new, unaudited attack surface for zero requirement in the design.
12. **CLI canonical-payload/Ed25519 code is a deliberate, tested duplicate of the backend's**,
    not a shared import — the two packages have no workspace link. Parity is enforced by a
    byte-exact golden-string fixture asserted identically in both `backend/src/signing/canonical-payload.spec.ts`
    and the CLI's `src/canonical-payload.spec.ts` (Phase 1 defines the string; Phase 5 reuses it
    verbatim).

---

## Critical-Path Verification Design

`VERIFICATION_RIGOR=critical_path` applies to this plan (signing/key-management, tenant-isolation
extension). Consolidated here; each item's tests already appear inline in the phase tasks above —
this section is the single place a reviewer can check the full set at once.

### Behavior contract
- `buildCanonicalPayload(fields)` — deterministic, pure function. Same logical `fields` input
  always produces the same byte string. `checks` key is present in the output **iff**
  `fields.checks !== undefined`; when present, entries always serialize exactly 7 fields in the
  fixed order `id, dimension, title, points, earned, passed, evidence`, silently dropping any other
  input property (`remediation`, `docsUrl`, or anything else).
- `SubmissionsService.buildInsertableSubmission(dto)` — rejects (never partially accepts) when:
  any `dimensions[].id` or `checks[].id` is a dangerous key; `keyId` is set without `signature`;
  the reconstructed canonical payload's signature doesn't verify against a non-revoked signing key
  whose `accountId` matches the resolved repo/account. Never performs a provisioning write.
- `SubmissionEvidenceService.getEvidence(id, requestingAccountId)` — returns `null` (never throws)
  for: non-UUID `id`, unknown `id`, and a private repo's submission when
  `requestingAccountId !== repo.accountId`. Returns the exact 13-field whitelist otherwise, never
  a superset.
- `generateAndSaveSigningKey()` — never overwrites an existing key file unless `force: true`;
  always leaves the key file at mode `0600` and its parent directory at `0700` on success; never
  includes private key bytes in its return value.
- `verifyPackage(id, apiUrl)` — `valid: true` **iff** the fetched evidence has both a `signature`
  and a `publicKey`, and locally reconstructing the canonical payload from the fetched fields and
  verifying it against that signature/key succeeds. Never throws for a 404 or an unsigned
  submission — always returns a structured `{ valid: false, reason }`.

### Edge-case catalog
| Case | Expected behavior | Covered by |
|------|--------------------|------------|
| `checks[]` omitted entirely | Canonical string omits the `checks` key outright (byte-identical to pre-extension format) | Task 1.1 |
| `checks[]` present but empty (`[]`) | Canonical string includes `"checks":[]`, distinguishable from omission | Task 1.1 |
| A check's evidence/points/earned/passed altered after signing | Canonical string changes; signature verification fails | Task 1.1, Task 2.1 |
| Signature computed over the pre-extension (no-`checks`) payload, but `checks[]` is attached to the request anyway | Rejected outright (`invalid signature`), never silently accepted with `checks[]` stripped | Task 2.1 |
| `checks[].id` is `__proto__`/`constructor`/`prototype` | Whole submission rejected (fail-closed), same as `dimensions[].id` | Task 1.2, Task 2.1 |
| Submission has `checks[]` but no `keyId`/`signature` (self-reported, unsigned evidence) | Accepted at the DTO/service layer (checks[] is independent of tier); `verified: false`; `verify-package` reports `valid: false, reason: unsigned` | Task 2.1 (implicit — no new tier-coupling added), Task 6.1 |
| `GET /submissions/:id/evidence` for an unknown id | 404 | Task 3.1, Task 3.3 |
| `GET /submissions/:id/evidence` for a malformed (non-UUID) id | 404, never 500, DB never queried | Task 3.1 (explicit `findOne` not-called assertion) |
| `GET /submissions/:id/evidence` for a private repo, non-owning/unauthenticated caller | 404, indistinguishable from unknown id | Task 3.1, Task 3.3 |
| `GET /submissions/:id/evidence` for a private repo, owning caller | 200, full evidence | Task 3.1, Task 3.3 |
| `GET /submissions/:id/evidence` for a submission whose signing key was later revoked | 200 with the historical signature/payload/publicKey as originally stored — revocation is not retroactive | Documented in Task 3.1's service doc comment; not separately unit-tested (accepted, matches design's Error Handling section) |
| `harnesslens keygen` run twice without `--force` | Second run fails loud (`already exists`), first key file untouched | Task 4.1 |
| `harnesslens submit` without `--sign` | Fails loud, never falls back to an unsigned submission | Task 5.3 (Durable Decision 9) |
| `harnesslens submit --sign` with no local key file | Fails loud, message points at `harnesslens keygen` | Task 5.3 |
| `harnesslens submit --sign` where the server rejects (400) | CLI exits 1, prints the server's rejection reason, never retries silently | Task 5.3 |

### Provable properties
1. `buildCanonicalPayload(fieldsWithoutChecks)` is byte-identical, character for character, to the
   pre-extension implementation's output for the same logical fields (regression-locked golden
   string, Task 1.1).
2. The CLI's `buildCanonicalPayload` and the backend's `buildCanonicalPayload` produce identical
   output for identical input (cross-package golden-file parity, Task 1.1 + Task 5.1 — same literal
   strings asserted on both sides).
3. Any single-byte change to a signed check's `evidence`/`points`/`earned`/`passed`/`id`/
   `dimension`/`title` changes the canonical string and therefore invalidates the signature
   (tamper-evidence, Task 1.1 + Task 2.1).
4. `GET /submissions/:id/evidence`'s response object has exactly the 13 whitelisted keys — never a
   superset — for every reachable code path (public, verified, unverified, with/without `checks`)
   (Task 3.1, Task 3.3's key-set regression test).
5. The private-key file on disk is `0600` and its parent directory `0700` after every successful
   `generateAndSaveSigningKey()` call, including a `--force` overwrite of a file whose permissions
   had drifted (Task 4.1).
6. `isDangerousKey` fail-closed rejection is whole-submission (never partial/silent-drop) for
   `checks[].id`, identical to the existing `dimensions[].id` behavior (Task 2.1).
7. `SubmissionEvidenceService.getEvidence` never calls `submissionsRepo.findOne` for a non-UUID
   `id` (Task 3.1 — asserted directly via mock call-count, not just observed output).

### Purity boundary map
| Function | Purity | Notes |
|----------|--------|-------|
| `buildCanonicalPayload` (backend + CLI) | Pure | No I/O; deterministic; safe to unit-test with plain assertions, no mocks needed. |
| `SubmissionsService.buildInsertableSubmission` | Impure (reads `signingKeysRepo`/`accountsRepo`/`reposRepo`) | Read-only DB access only — no writes, no provisioning (existing Durable Decision from the prior build, preserved). |
| `SubmissionEvidenceService.getEvidence` | Impure (reads `submissionsRepo`/`signingKeysRepo`) | Read-only; the `isUUID` short-circuit is pure and runs before any I/O. |
| `SubmissionsController.create` / `.getEvidence` | Impure (delegates to services; `create` triggers the one permanent write via `ReposService.findOrCreateForSubmission`, unchanged from the existing build) | `getEvidence` performs no writes at all. |
| `generateAndSaveSigningKey` | Impure (filesystem: `mkdirSync`, `writeFileSync`, `chmodSync`, `existsSync`) | The only function in this plan that writes a secret to disk; isolated to `src/keys.ts`. |
| `loadSigningKey` | Impure (filesystem read) | Never writes. |
| `buildSignedSubmissionBody` | Pure except for the `sign()` call (CPU-only, no I/O) | Deterministic given identical `scannedAt`; `node:crypto`'s `sign` has no side effects beyond CPU. |
| `verifyPackage` | Impure (network `fetch`) | The only new CLI function that performs network I/O; `fetchImpl` is injectable for pure unit testing. |
| CLI `runSubmitCommand`/`runKeygenCommand`/`main` (`cli.ts`) | Impure (fs via `keys.ts`, network via `fetchImpl`, stdout/stderr via `io`) | Thin orchestration only, per the existing `api.ts`/`cli.ts` split — no new business logic lives here. |

### Verification strategy
- **Unit (pure logic):** `canonical-payload.spec.ts` (both packages), `create-submission.dto.spec.ts`,
  `submissions.service.spec.ts`, `submission-evidence.service.spec.ts`, `keys.spec.ts`,
  `evidence-package.spec.ts`, `verify-package.spec.ts`, `ed25519.spec.ts`, `cli.spec.ts` — no DB,
  no Docker, run on every `npm test`.
- **Integration (real Postgres, ephemeral Testcontainers):** `schema.int-spec.ts` (new column
  assertion), `submissions-evidence.e2e-spec.ts`, updated `submissions-verified.e2e-spec.ts` —
  `npm run test:integration`.
- **Live (full compose stack):** `./scripts/run-live-proof.sh` against the real Docker-built `api`
  container + Postgres — proves the migration applies cleanly and the full HTTP round trip works,
  not just the in-process NestJS module.
- **Manual end-to-end (cross-package, cross-process):** Task 6.3 Step 3 — the only step that
  exercises the *actual* CLI binary against the *actual* running backend over real HTTP, proving
  the two independently-maintained canonical-payload implementations genuinely agree in practice,
  not just in their golden-string unit tests.

---

## Phase Dependency Map

- **Phase 1** (backend canonical payload + DTO): depends on nothing new (extends existing
  `canonical-payload.ts`/`create-submission.dto.ts`). Creates: the `checks[]` field contract
  (fixed key order, conditional inclusion) and its two golden strings (backward-compat,
  with-checks) — every later phase's tests reuse these exact strings. Enables: Phase 2 (service
  wiring needs the DTO shape), Phase 5 (CLI mirror needs the golden strings to copy).
- **Phase 2** (storage): depends on Phase 1's DTO `checks[]` shape and canonical-payload contract.
  Creates: the `submissions.checks` column, the migration file, and the updated `migrations: [...]`
  arrays in all 14 test files — every later backend integration/e2e test depends on this migration
  being present in its own `DataSource`. Enables: Phase 3 (evidence endpoint needs a real column to
  read from).
- **Phase 3** (verify surface): depends on Phase 2's `checks` column and Phase 1's canonical
  payload contract (the e2e golden-path test reconstructs it). Creates: `GET
  /submissions/:id/evidence`'s 13-field response contract — Phase 6's CLI `verify-package` depends
  on this exact shape. Enables: Phase 6.
- **Phase 4** (CLI keygen): depends on nothing from Phases 1–3 (purely local `node:crypto` + fs).
  Creates: `~/.harnesslens/signing-key.json` file contract and `loadSigningKey()`'s return shape.
  Enables: Phase 5 (needs a local key to sign with).
- **Phase 5** (CLI evidence-package build/sign/submit): depends on Phase 1's canonical payload
  golden strings (copied verbatim for parity) and Phase 4's `loadSigningKey()`. Creates:
  `buildSignedSubmissionBody`'s request-body shape — must exactly match Phase 1/2's DTO. Enables:
  Phase 6 (verify-package reuses the same canonical-payload/ed25519 mirrors).
- **Phase 6** (CLI verify-package + docs): depends on Phase 3's evidence-endpoint response shape
  and Phase 5's canonical-payload/ed25519 mirrors. Creates: the final end-to-end proof (Task 6.3)
  that closes the loop across all 6 phases.

---

## Phase 1: Backend — canonical payload `checks[]` contract (foundation, critical-path)

> **Exit Criteria:** `buildCanonicalPayload` accepts an optional `checks[]` field with a fixed
> position in the field order; omitting it produces a byte-identical string to today's
> pre-extension output (regression-proven); `CreateSubmissionDto` accepts and validates an
> optional `checks[]` array with the same dangerous-key protection as `dimensions[]`.
> `cd backend && npm test` passes.

### Task 1.1: Extend `buildCanonicalPayload` with a conditionally-included `checks[]` field

**Files:**
- Modify: `backend/src/signing/canonical-payload.ts`
- Create: `backend/src/signing/canonical-payload.spec.ts`

**Step 1: Write the failing tests**

```ts
// backend/src/signing/canonical-payload.spec.ts
import { describe, it, expect } from 'vitest';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload';

const baseFields: CanonicalSubmissionFields = {
  repoId: 'acme/widgets',
  score: 82.5,
  level: { index: 3, name: 'L3 Systematized' },
  dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
  frameworkMapping: {},
  commitSha: 'a1b2c3d',
  scannedAt: '2026-08-13T00:00:00.000Z',
};

describe('buildCanonicalPayload -- backward compatibility (Durable Decision 2)', () => {
  it('omitting checks[] produces the exact pre-extension canonical string (no "checks" key at all)', () => {
    const result = buildCanonicalPayload(baseFields);
    expect(result).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"frameworkMapping":{},"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
    expect(result.includes('"checks"')).toBe(false);
  });
});

describe('buildCanonicalPayload -- checks[] extension', () => {
  const fieldsWithChecks: CanonicalSubmissionFields = {
    ...baseFields,
    frameworkMapping: {
      ci: { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI04', 'ASI08'] },
    },
    checks: [
      {
        id: 'CTX-01',
        dimension: 'context',
        title: 'Has AGENTS.md',
        points: 5,
        earned: 5,
        passed: true,
        evidence: 'Found AGENTS.md at repo root',
      },
    ],
  };

  it('includes checks[] between dimensions and frameworkMapping, fixed per-entry field order', () => {
    const result = buildCanonicalPayload(fieldsWithChecks);
    expect(result).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"checks":[{"id":"CTX-01","dimension":"context","title":"Has AGENTS.md","points":5,' +
        '"earned":5,"passed":true,"evidence":"Found AGENTS.md at repo root"}],' +
        '"frameworkMapping":{"ci":{"nistFunctions":["Measure","Manage"],"owaspIds":["ASI04","ASI08"]}},' +
        '"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
  });

  it('an empty checks[] array is distinguishable from an omitted checks[] field', () => {
    const withEmpty = buildCanonicalPayload({ ...baseFields, checks: [] });
    const omitted = buildCanonicalPayload(baseFields);
    expect(withEmpty).not.toBe(omitted);
    expect(withEmpty.includes('"checks":[]')).toBe(true);
  });

  it('tamper-evidence: altering one check\'s evidence text after signing changes the canonical string', () => {
    const tampered = buildCanonicalPayload({
      ...fieldsWithChecks,
      checks: [{ ...fieldsWithChecks.checks![0]!, evidence: 'ALTERED' }],
    });
    expect(tampered).not.toBe(buildCanonicalPayload(fieldsWithChecks));
  });

  it('drops remediation/docsUrl-shaped extra keys if present on input (only 7 fields are ever serialized)', () => {
    const withExtra = {
      ...fieldsWithChecks,
      checks: [{ ...fieldsWithChecks.checks![0]!, remediation: 'fix it', docsUrl: 'https://x' } as never],
    };
    const result = buildCanonicalPayload(withExtra);
    expect(result.includes('remediation')).toBe(false);
    expect(result.includes('docsUrl')).toBe(false);
  });
});
```

**Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/signing/canonical-payload.spec.ts`
Expected: FAIL — `CanonicalSubmissionFields` has no `checks` property (TypeScript compile error
under the SWC transform) and the literal golden strings don't match current output.

**Step 3: Implement**

```ts
// backend/src/signing/canonical-payload.ts
export interface CanonicalCheckField {
  id: string;
  dimension: string;
  title: string;
  points: number;
  earned: number;
  passed: boolean;
  evidence: string;
}

export interface CanonicalSubmissionFields {
  repoId: string;
  score: number;
  level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
  /** Omitted entirely from the canonical string when undefined -- see Durable Decision 2. */
  checks?: CanonicalCheckField[];
  frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  commitSha: string;
  scannedAt: string;
}

export function buildCanonicalPayload(f: CanonicalSubmissionFields): string {
  const sortedMapping = Object.fromEntries(
    Object.keys(f.frameworkMapping)
      .sort()
      .map((k) => [k, f.frameworkMapping[k]]),
  );

  const payload: Record<string, unknown> = {
    repoId: f.repoId,
    score: f.score,
    level: { index: f.level.index, name: f.level.name },
    dimensions: f.dimensions.map((d) => ({
      id: d.id,
      title: d.title,
      earned: d.earned,
      max: d.max,
      percent: d.percent,
    })),
  };

  // Conditionally inserted (never `checks: null`/`checks: undefined`) so a submission that omits
  // checks[] entirely produces a byte-identical canonical string to the pre-extension shape --
  // JSON.stringify drops a key assigned `undefined`, but only if the key is never assigned at all
  // here (assigning `payload.checks = undefined` would still be fine for JSON.stringify's output,
  // but this `if` makes the omission explicit and testable rather than relying on that nuance).
  if (f.checks !== undefined) {
    payload.checks = f.checks.map((c) => ({
      id: c.id,
      dimension: c.dimension,
      title: c.title,
      points: c.points,
      earned: c.earned,
      passed: c.passed,
      evidence: c.evidence,
    }));
  }

  payload.frameworkMapping = sortedMapping;
  payload.commitSha = f.commitSha;
  payload.scannedAt = f.scannedAt;

  return JSON.stringify(payload);
}
```

**Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/signing/canonical-payload.spec.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/signing/canonical-payload.ts backend/src/signing/canonical-payload.spec.ts
git commit -m "feat(backend): extend canonical payload with optional checks[] field"
```

### Task 1.2: Extend `CreateSubmissionDto` with optional `checks[]`

**Files:**
- Modify: `backend/src/submissions/dto/create-submission.dto.ts`
- Modify: `backend/src/submissions/dto/create-submission.dto.spec.ts`

**Step 1: Write failing tests** — append to `create-submission.dto.spec.ts`:

```ts
const checksPayload = [
  {
    id: 'CTX-01',
    dimension: 'context',
    title: 'Has AGENTS.md',
    points: 5,
    earned: 5,
    passed: true,
    evidence: 'Found AGENTS.md at repo root',
  },
];

it('accepts a valid payload with checks[]', async () => {
  const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, checks: checksPayload });
  expect(await validate(dto)).toHaveLength(0);
});

it('accepts a payload with no checks[] at all (checks stays optional)', async () => {
  const dto = plainToInstance(CreateSubmissionDto, validPayload);
  expect(await validate(dto)).toHaveLength(0);
});

it('rejects a check with id "__proto__"', async () => {
  const dto = plainToInstance(CreateSubmissionDto, {
    ...validPayload,
    checks: [{ ...checksPayload[0], id: '__proto__' }],
  });
  const errors = await validate(dto);
  expect(errors.length).toBeGreaterThan(0);
});

it('rejects a check missing the required "passed" boolean', async () => {
  const { passed, ...withoutPassed } = checksPayload[0]!;
  const dto = plainToInstance(CreateSubmissionDto, { ...validPayload, checks: [withoutPassed] });
  const errors = await validate(dto);
  expect(errors.length).toBeGreaterThan(0);
});
```

**Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/submissions/dto/create-submission.dto.spec.ts`
Expected: FAIL — `checks` is not a known/whitelisted DTO property yet.

**Step 3: Implement** — in `create-submission.dto.ts`, add `IsBoolean` to the `class-validator`
import list, add a `CheckDto` class mirroring `DimensionDto`, and add the field to
`CreateSubmissionDto`:

```ts
import { IsArray, IsBoolean, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Matches, Max, ValidateNested } from 'class-validator';

class CheckDto {
  @IsString() @Matches(SAFE_ID_RE) id!: string;
  @IsString() dimension!: string;
  @IsString() title!: string;
  @IsNumber() points!: number;
  @IsNumber() earned!: number;
  @IsBoolean() passed!: boolean;
  @IsString() evidence!: string;
}
```

Add below the existing `dimensions` field:

```ts
  // Optional, mirrors dimensions[]'s validation pattern -- remediation/docsUrl deliberately
  // excluded (Durable Decision 3). SAFE_ID_RE here is the DTO-layer half of the two-layer
  // dangerous-key defense; submissions.service.ts's isDangerousKey loop is the other half
  // (Durable Decision 4).
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CheckDto) checks?: CheckDto[];
```

**Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/submissions/dto/create-submission.dto.spec.ts`
Expected: PASS (8 tests total, 4 new)

**Step 5: Run the full backend unit suite, verify no regressions**

Run: `cd backend && npm test`
Expected: PASS, 0 failures.

**Step 6: Commit**

```bash
git add backend/src/submissions/dto/create-submission.dto.ts backend/src/submissions/dto/create-submission.dto.spec.ts
git commit -m "feat(backend): accept optional checks[] on CreateSubmissionDto"
```

---

## Phase 2: Backend — storage (migration, entity, service wiring)

> **Exit Criteria:** `submissions.checks` is a nullable `jsonb` column; `SubmissionsService`
> reconstructs, dangerous-key-guards, persists, and includes `checks[]` in verified-tier signature
> verification, field-by-field (never `{ ...dto }`). `cd backend && npm test` and
> `npm run test:integration` both pass.

### Task 2.1: Wire `checks[]` through `SubmissionsService.buildInsertableSubmission`

**Files:**
- Modify: `backend/src/submissions/submissions.service.ts`
- Modify: `backend/src/submissions/submissions.service.spec.ts`

**Step 1: Write failing tests** — append to `submissions.service.spec.ts` (reuses the file's
existing `validDto`, `signingKeysRepoStub`/`accountsRepoStub`/`reposRepoStub`/`service` fixtures):

```ts
const validChecks = [
  {
    id: 'CTX-01',
    dimension: 'context',
    title: 'Has AGENTS.md',
    points: 5,
    earned: 5,
    passed: true,
    evidence: 'Found AGENTS.md at repo root',
  },
];

it('reconstructs checks[] field-by-field into the insertable row when present', async () => {
  const dto = { ...validDto, checks: validChecks } as CreateSubmissionDto;
  const result = await service.buildInsertableSubmission(dto);
  expect(result.ok).toBe(true);
  expect(result.ok && result.row.checks).toEqual(validChecks);
});

it('stores checks as null when the submission omits checks[] entirely', async () => {
  const result = await service.buildInsertableSubmission(validDto);
  expect(result.ok).toBe(true);
  expect(result.ok && result.row.checks).toBeNull();
});

it('rejects a submission with a dangerous checks[].id (fail-closed, mirrors dimensions[].id)', async () => {
  const dto = {
    ...validDto,
    checks: [{ ...validChecks[0], id: '__proto__' }],
  } as CreateSubmissionDto;
  const result = await service.buildInsertableSubmission(dto);
  expect(result.ok).toBe(false);
  expect(result.ok === false && result.reason).toBe('checks contains a dangerous key: __proto__');
});

it('never spreads the raw DTO checks[] into the insert row', async () => {
  const dto = {
    ...validDto,
    checks: [{ ...validChecks[0], maliciousExtra: 'nope' }],
  } as unknown as CreateSubmissionDto;
  const result = await service.buildInsertableSubmission(dto);
  expect(result.ok).toBe(true);
  expect(
    result.ok && (result.row.checks?.[0] as unknown as { maliciousExtra?: unknown }).maliciousExtra,
  ).toBeUndefined();
});
```

Also add a new `describe` block covering the verified-tier + checks[] interaction (append near the
existing verified-tier tests, reusing that section's `generateKeyPairSync`/`rawPublicKeyBase64`
helpers):

```ts
it('a verified-tier submission with checks[] verifies against the extended canonical payload', async () => {
  const dtoWithChecks: CreateSubmissionDto = {
    ...validDto,
    checks: validChecks,
    keyId: 'key-1',
    signature: '',
  } as CreateSubmissionDto;
  const fields: CanonicalSubmissionFields = {
    repoId: dtoWithChecks.repoId,
    score: dtoWithChecks.score,
    level: dtoWithChecks.level,
    dimensions: dtoWithChecks.dimensions,
    checks: validChecks,
    frameworkMapping: dtoWithChecks.frameworkMapping,
    commitSha: dtoWithChecks.commitSha,
    scannedAt: dtoWithChecks.scannedAt,
  };
  dtoWithChecks.signature = sign(null, Buffer.from(buildCanonicalPayload(fields), 'utf8'), privateKey).toString('base64');

  const signingKeysRepoStub = {
    findOneBy: vi.fn().mockResolvedValue({ keyId: 'key-1', accountId: 'shared-account', publicKey: publicKeyBase64, revokedAt: null }),
  } as unknown as Repository<SigningKey>;
  const accountsRepoStub = { findOneBy: vi.fn() } as unknown as Repository<Account>;
  const reposRepoStub = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'repo-uuid', accountId: 'shared-account' } as Repo),
  } as unknown as Repository<Repo>;
  const svc = new SubmissionsService(signingKeysRepoStub, accountsRepoStub, reposRepoStub);

  const result = await svc.buildInsertableSubmission(dtoWithChecks);
  expect(result.ok).toBe(true);
  expect(result.ok && result.row.verified).toBe(true);
  expect(result.ok && result.row.checks).toEqual(validChecks);
});

it('a verified-tier submission whose signature was computed WITHOUT checks[] fails when checks[] is added to the request body (tamper/downgrade rejection)', async () => {
  // Signs the OLD (no-checks) canonical payload but attaches checks[] to the request anyway --
  // must be rejected outright, not silently accepted with checks[] stripped.
  const oldFields: CanonicalSubmissionFields = {
    repoId: validDto.repoId, score: validDto.score, level: validDto.level,
    dimensions: validDto.dimensions, frameworkMapping: validDto.frameworkMapping,
    commitSha: validDto.commitSha, scannedAt: validDto.scannedAt,
  };
  const signature = sign(null, Buffer.from(buildCanonicalPayload(oldFields), 'utf8'), privateKey).toString('base64');
  const dto = { ...validDto, checks: validChecks, keyId: 'key-1', signature } as CreateSubmissionDto;

  const signingKeysRepoStub = {
    findOneBy: vi.fn().mockResolvedValue({ keyId: 'key-1', accountId: 'shared-account', publicKey: publicKeyBase64, revokedAt: null }),
  } as unknown as Repository<SigningKey>;
  const accountsRepoStub = { findOneBy: vi.fn() } as unknown as Repository<Account>;
  const reposRepoStub = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'repo-uuid', accountId: 'shared-account' } as Repo),
  } as unknown as Repository<Repo>;
  const svc = new SubmissionsService(signingKeysRepoStub, accountsRepoStub, reposRepoStub);

  const result = await svc.buildInsertableSubmission(dto);
  expect(result.ok).toBe(false);
  expect(result.ok === false && result.reason).toBe('invalid signature');
});
```

**Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/submissions/submissions.service.spec.ts`
Expected: FAIL — `InsertableSubmissionFields` has no `checks` property; dangerous-key loop doesn't
scan `dto.checks`; canonical payload built for verification doesn't include `checks`.

**Step 3: Implement** — in `submissions.service.ts`:

```ts
export interface InsertableSubmissionFields {
  score: string;
  level: { index: number; name: string };
  dimensions: Array<{ id: string; title: string; earned: number; max: number; percent: number }>;
  checks: Array<{
    id: string; dimension: string; title: string; points: number; earned: number; passed: boolean; evidence: string;
  }> | null;
  frameworkMapping: Record<string, { nistFunctions: string[]; owaspIds: string[] }>;
  commitSha: string;
  scannedAt: Date;
  verified: boolean;
  signature: string | null;
  keyId: string | null;
}
```

In `buildInsertableSubmission`, after the existing `dto.dimensions` dangerous-key loop, add:

```ts
    for (const check of dto.checks ?? []) {
      if (isDangerousKey(check.id)) {
        return { ok: false, reason: `checks contains a dangerous key: ${check.id}` };
      }
    }
```

After `reconstructedDimensions`, add:

```ts
    const reconstructedChecks =
      dto.checks?.map((c) => ({
        id: c.id, dimension: c.dimension, title: c.title, points: c.points,
        earned: c.earned, passed: c.passed, evidence: c.evidence,
      })) ?? null;
```

In the `row` object literal, add `checks: reconstructedChecks,`.

In `verifySignedSubmission`'s parameter list, add `checks: InsertableSubmissionFields['checks']`,
and in its `buildCanonicalPayload(...)` call, add `checks: checks ?? undefined,` (converts the
row's `null` back to `undefined` so the canonical builder omits the key entirely for a
no-checks submission — preserving Durable Decision 2). Update the one call site in
`buildInsertableSubmission` that invokes `verifySignedSubmission` to pass `reconstructedChecks`.

**Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/submissions/submissions.service.spec.ts`
Expected: PASS (all existing + 6 new tests)

**Step 5: Run full backend unit suite**

Run: `cd backend && npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/submissions/submissions.service.ts backend/src/submissions/submissions.service.spec.ts
git commit -m "feat(backend): persist and verify checks[] in SubmissionsService"
```

### Task 2.2: Add `checks` column — entity + migration + update all migration-consuming test files

**Files:**
- Modify: `backend/src/submissions/entities/submission.entity.ts`
- Create: `backend/src/migrations/<timestamp>-AddChecksToSubmissions.ts`
- Modify (add the new migration to each file's `migrations: [...]` array and import): all 14 files
  currently importing `InitSchema1786633235167`:
  `test/integration/repos.service.int-spec.ts`, `test/integration/submissions-controller-ordering.int-spec.ts`,
  `test/integration/schema.int-spec.ts`, `test/integration/query.service.int-spec.ts`,
  `test/e2e/query-public-list.e2e-spec.ts`, `test/e2e/repos-visibility.e2e-spec.ts`,
  `test/e2e/accounts.e2e-spec.ts`, `test/e2e/submissions.e2e-spec.ts`,
  `test/e2e/query-tie-break-ordering.e2e-spec.ts`, `test/e2e/query-public-detail.e2e-spec.ts`,
  `test/e2e/query-private.e2e-spec.ts`, `test/e2e/submissions-rate-limit.e2e-spec.ts`,
  `test/e2e/submissions-verified.e2e-spec.ts`, `test/e2e/signing-keys.e2e-spec.ts`
  (`backend/src/data-source.ts` needs no change — it already globs `src/migrations/*.ts`).

**Step 1: Entity change (write first, no test needed for a column-type addition alone — TypeORM
entity fields are exercised indirectly by the integration tests below)**

```ts
// submission.entity.ts -- add after the frameworkMapping column
  @Column({ type: 'jsonb', nullable: true })
  checks!: unknown;
```

**Step 2: Bring up a local Postgres and generate the migration**

Run:
```bash
cd backend
docker compose up -d --wait
npm run migration:generate -- src/migrations/AddChecksToSubmissions
```
Expected: a new file `backend/src/migrations/<timestamp>-AddChecksToSubmissions.ts` is generated,
containing `ALTER TABLE "submissions" ADD "checks" jsonb` in `up()` and the symmetric `DROP COLUMN`
in `down()` (matching `InitSchema1786633235167`'s raw-SQL-migration style — do not hand-edit the
generated class name/timestamp).

**Step 3: Write the failing schema-integration test** — extend `schema.int-spec.ts`'s existing
`it('creates all five tables...')` test (or add a new one) to also assert the new column:

```ts
it('submissions table has a nullable checks jsonb column after migrations', async () => {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const ds = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    entities: [Account, SigningKey, Repo, Submission, RejectedSubmission],
    migrations: [InitSchema1786633235167, AddChecksToSubmissions<timestamp>],
  });
  await ds.initialize();
  await ds.runMigrations();
  const cols = await ds.query(
    `select column_name, is_nullable, data_type from information_schema.columns where table_name = 'submissions' and column_name = 'checks'`,
  );
  expect(cols).toEqual([{ column_name: 'checks', is_nullable: 'YES', data_type: 'jsonb' }]);
  await ds.destroy();
  await container.stop();
}, 60_000);
```

**Step 4: Run, verify fail (pre-migration-array-update state)**

Run: `cd backend && npm run test:integration -- schema.int-spec.ts`
Expected: FAIL — `checks` column does not exist yet in this test's `migrations` array (the
migration file exists on disk but isn't wired into this test's `DataSource`).

**Step 5: Add the import + array entry to all 14 files listed above** (each file: add
`import { AddChecksToSubmissions<timestamp> } from '../../src/migrations/<timestamp>-AddChecksToSubmissions';`
and append it to the existing `migrations: [InitSchema1786633235167]` array/arrays — some files
have more than one `DataSource` instantiation, e.g. `repos.service.int-spec.ts` has two at lines 25
and 75; update every occurrence, not just the first).

**Step 6: Run, verify pass**

Run: `cd backend && npm run test:integration`
Expected: PASS — all integration + e2e specs still pass (their own schema now includes `checks`),
plus the new schema assertion passes.

**Step 7: Run the production migration against the compose stack to prove it applies cleanly**

Run:
```bash
cd backend
npm run migration:run
docker compose exec db psql -U harnesslens -d harnesslens -c "\d submissions" | grep checks
```
Expected: `checks | jsonb |` appears in the column listing.

**Step 8: Commit**

```bash
git add backend/src/submissions/entities/submission.entity.ts backend/src/migrations/ backend/test/
git commit -m "feat(backend): add nullable checks jsonb column + migration, wire into all schema-consuming tests"
```

---

## Phase 3: Backend — verify surface (`GET /submissions/:id/evidence`)

> **Exit Criteria:** `GET /submissions/:id/evidence` returns an explicit field-whitelisted
> response (never a raw entity/spread), 404s for unknown/malformed/private-not-owned ids
> identically, and includes the registered public key for a verified submission's `keyId` so a
> caller can independently reconstruct + verify the signature. `cd backend && npm run
> test:integration` passes; new e2e coverage added to the live-proof manifest.

### Task 3.1: `SubmissionEvidenceService`

**Files:**
- Create: `backend/src/submissions/submission-evidence.service.ts`
- Create: `backend/src/submissions/submission-evidence.service.spec.ts`

**Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { SubmissionEvidenceService } from './submission-evidence.service';
import type { Submission } from './entities/submission.entity';
import type { SigningKey } from '../signing-keys/entities/signing-key.entity';

function stubSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'sub-1', repoId: 'repo-uuid',
    repo: { id: 'repo-uuid', repoId: 'acme/widgets', accountId: 'acc-1', visibility: 'public' },
    score: '82.50', level: { index: 3, name: 'L3' }, dimensions: [], checks: null,
    frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: new Date('2026-08-13T00:00:00.000Z'),
    verified: false, signature: null, keyId: null, submittedAt: new Date(),
    ...overrides,
  } as unknown as Submission;
}

describe('SubmissionEvidenceService.getEvidence', () => {
  it('returns an explicit field-whitelisted shape for a public submission (no raw entity leak)', async () => {
    const submissionsRepo = { findOne: vi.fn().mockResolvedValue(stubSubmission()) } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);

    const result = await svc.getEvidence('sub-1', undefined);

    expect(result).toEqual({
      id: 'sub-1', repoId: 'acme/widgets', score: 82.5, level: { index: 3, name: 'L3' },
      dimensions: [], checks: null, frameworkMapping: {}, commitSha: 'a1b2c3d',
      scannedAt: '2026-08-13T00:00:00.000Z', verified: false, signature: null, keyId: null,
      publicKey: null,
    });
  });

  it('includes the registered public key for a verified submission', async () => {
    const submissionsRepo = {
      findOne: vi.fn().mockResolvedValue(stubSubmission({ verified: true, signature: 'sig', keyId: 'key-1' })),
    } as unknown as Repository<Submission>;
    const signingKeysRepo = {
      findOneBy: vi.fn().mockResolvedValue({ keyId: 'key-1', publicKey: 'base64pubkey' }),
    } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);

    const result = await svc.getEvidence('sub-1', undefined);
    expect(result?.publicKey).toBe('base64pubkey');
  });

  it('returns null for an unknown submission id', async () => {
    const submissionsRepo = { findOne: vi.fn().mockResolvedValue(null) } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence('does-not-exist', undefined)).toBeNull();
  });

  it('returns null (not the evidence) for a private repo when the requesting account does not own it', async () => {
    const submissionsRepo = {
      findOne: vi.fn().mockResolvedValue(stubSubmission({ repo: { id: 'repo-uuid', repoId: 'acme/widgets', accountId: 'owner-account', visibility: 'private' } as never })),
    } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence('sub-1', 'a-different-account')).toBeNull();
  });

  it('returns the evidence for a private repo when the requesting account IS the owner', async () => {
    const submissionsRepo = {
      findOne: vi.fn().mockResolvedValue(stubSubmission({ repo: { id: 'repo-uuid', repoId: 'acme/widgets', accountId: 'owner-account', visibility: 'private' } as never })),
    } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence('sub-1', 'owner-account')).not.toBeNull();
  });

  it('returns null (never throws/500s) for a malformed, non-UUID submission id', async () => {
    const submissionsRepo = { findOne: vi.fn() } as unknown as Repository<Submission>;
    const signingKeysRepo = { findOneBy: vi.fn() } as unknown as Repository<SigningKey>;
    const svc = new SubmissionEvidenceService(submissionsRepo, signingKeysRepo);
    expect(await svc.getEvidence('not-a-uuid', undefined)).toBeNull();
    expect(submissionsRepo.findOne).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/submissions/submission-evidence.service.spec.ts`
Expected: FAIL — module does not exist yet.

**Step 3: Implement**

```ts
// backend/src/submissions/submission-evidence.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import type { Repository } from 'typeorm';
import { Submission } from './entities/submission.entity';
import { SigningKey } from '../signing-keys/entities/signing-key.entity';

export interface SubmissionEvidence {
  id: string;
  repoId: string;
  score: number;
  level: unknown;
  dimensions: unknown;
  checks: unknown;
  frameworkMapping: unknown;
  commitSha: string;
  scannedAt: string;
  verified: boolean;
  signature: string | null;
  keyId: string | null;
  publicKey: string | null;
}

@Injectable()
export class SubmissionEvidenceService {
  constructor(
    @InjectRepository(Submission) private readonly submissionsRepo: Repository<Submission>,
    @InjectRepository(SigningKey) private readonly signingKeysRepo: Repository<SigningKey>,
  ) {}

  /**
   * Returns null for: unknown id, malformed (non-UUID) id (Durable Decision 8 -- never 500s), and
   * a private repo's submission when requestingAccountId doesn't own it (Durable Decision 7) --
   * all three are intentionally indistinguishable to the caller (404 either way at the controller).
   */
  async getEvidence(id: string, requestingAccountId: string | undefined): Promise<SubmissionEvidence | null> {
    if (!isUUID(id)) {
      return null;
    }

    const submission = await this.submissionsRepo.findOne({ where: { id }, relations: ['repo'] });
    if (!submission?.repo) {
      return null;
    }
    if (submission.repo.visibility === 'private' && submission.repo.accountId !== requestingAccountId) {
      return null;
    }

    let publicKey: string | null = null;
    if (submission.keyId) {
      const key = await this.signingKeysRepo.findOneBy({ keyId: submission.keyId });
      publicKey = key?.publicKey ?? null;
    }

    // Explicit field whitelist -- never `{ ...submission }` (never leak repo_id UUID, internal
    // relation objects, submittedAt, or any future entity field by accident).
    return {
      id: submission.id,
      repoId: submission.repo.repoId,
      score: Number(submission.score),
      level: submission.level,
      dimensions: submission.dimensions,
      checks: submission.checks ?? null,
      frameworkMapping: submission.frameworkMapping,
      commitSha: submission.commitSha,
      scannedAt: submission.scannedAt.toISOString(),
      verified: submission.verified,
      signature: submission.signature,
      keyId: submission.keyId,
      publicKey,
    };
  }
}
```

**Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/submissions/submission-evidence.service.spec.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add backend/src/submissions/submission-evidence.service.ts backend/src/submissions/submission-evidence.service.spec.ts
git commit -m "feat(backend): add SubmissionEvidenceService (field-whitelisted, visibility-aware)"
```

### Task 3.2: Wire the `GET /submissions/:id/evidence` route

**Files:**
- Modify: `backend/src/submissions/submissions.controller.ts`
- Modify: `backend/src/submissions/submissions.controller.spec.ts`
- Modify: `backend/src/submissions/submissions.module.ts`

**Step 1: Write failing controller unit test** — append to `submissions.controller.spec.ts`:

```ts
describe('SubmissionsController.getEvidence', () => {
  it('throws NotFoundException when SubmissionEvidenceService returns null', async () => {
    const evidenceService = { getEvidence: vi.fn().mockResolvedValue(null) } as unknown as SubmissionEvidenceService;
    const controller = new SubmissionsController(reposServiceStub, submissionsServiceStub, submissionsRepoStub, evidenceService);
    await expect(controller.getEvidence('sub-1', {})).rejects.toThrow(NotFoundException);
  });

  it('returns the service result as-is when found', async () => {
    const evidence = { id: 'sub-1', repoId: 'acme/widgets' /* ...rest omitted for brevity */ };
    const evidenceService = { getEvidence: vi.fn().mockResolvedValue(evidence) } as unknown as SubmissionEvidenceService;
    const controller = new SubmissionsController(reposServiceStub, submissionsServiceStub, submissionsRepoStub, evidenceService);
    await expect(controller.getEvidence('sub-1', {})).resolves.toBe(evidence);
  });
});
```

(Add the necessary `reposServiceStub`/`submissionsServiceStub`/`submissionsRepoStub` fixtures at
the top of the file if the existing tests don't already expose reusable ones — check the existing
`describe('SubmissionsController.create ...')` block's constructor call and mirror its stubs.)

**Step 2: Run, verify fail**

Run: `cd backend && npx vitest run src/submissions/submissions.controller.spec.ts`
Expected: FAIL — `SubmissionsController` doesn't accept a 4th constructor arg or expose
`getEvidence` yet.

**Step 3: Implement** — in `submissions.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { OptionalApiKeyGuard } from '../auth/optional-api-key.guard';
import { SubmissionEvidenceService } from './submission-evidence.service';
import type { Account } from '../accounts/entities/account.entity';
// ...existing imports unchanged...

interface RequestWithAccount {
  account?: Account;
}

@Controller('submissions')
@UseFilters(SubmissionRejectionFilter)
export class SubmissionsController {
  constructor(
    private readonly reposService: ReposService,
    private readonly submissionsService: SubmissionsService,
    @InjectRepository(Submission) private readonly submissionsRepo: Repository<Submission>,
    private readonly evidenceService: SubmissionEvidenceService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  async create(@Body() dto: CreateSubmissionDto) { /* unchanged */ }

  @Get(':id/evidence')
  @UseGuards(OptionalApiKeyGuard)
  async getEvidence(@Param('id') id: string, @Req() req: RequestWithAccount) {
    const evidence = await this.evidenceService.getEvidence(id, req.account?.id);
    if (!evidence) {
      throw new NotFoundException();
    }
    return evidence;
  }
}
```

Note: moving `@UseGuards(ThrottlerGuard)` from the class level to the `create` method only, so the
new `GET` route is not throttled — matching the existing, documented convention that only
`POST /submissions` is rate-limited (see `backend/README.md`'s "Known v1 limitations"; other GET
endpoints across this backend are consistently unthrottled too). `@UseFilters(SubmissionRejectionFilter)`
stays class-level since it's specific to write-path rejection auditing and the new GET route's own
404 is not a "rejected submission" in that sense — confirm in Step 4 that the filter's presence has
no observable effect on the GET route's 404 response shape (it shouldn't; NestJS filters apply per
exception type region regardless, but `SubmissionRejectionFilter`'s `@Catch()` catches
*everything*, including the `NotFoundException` this route throws — verify in the e2e test below
that the response is still a clean `404` with the expected NestJS default body, and that no spurious
`rejected_submissions` row is written for a plain evidence-lookup 404. If the e2e test in Task 3.3
shows the filter's blanket `@Catch()` incorrectly audits GET-route 404s as rejected submissions,
scope `@UseFilters(SubmissionRejectionFilter)` down to `@Post()` only instead of the class level).

In `submissions.module.ts`, add `SubmissionEvidenceService` to `providers`, and add `SigningKey` to
the existing `TypeOrmModule.forFeature([...])` import list (it is not currently there — check
before assuming; `Account, Repo, Submission, RejectedSubmission, SigningKey` are already all listed
per the file read earlier, so no module import-list change should be needed for entities, only the
new provider).

**Step 4: Run, verify pass**

Run: `cd backend && npx vitest run src/submissions/submissions.controller.spec.ts`
Expected: PASS

**Step 5: Run full backend unit suite**

Run: `cd backend && npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/submissions/submissions.controller.ts backend/src/submissions/submissions.controller.spec.ts backend/src/submissions/submissions.module.ts
git commit -m "feat(backend): wire GET /submissions/:id/evidence route"
```

### Task 3.3: e2e coverage + live-proof manifest update

**Files:**
- Create: `backend/test/e2e/submissions-evidence.e2e-spec.ts` (model structure on
  `test/e2e/submissions-verified.e2e-spec.ts`, including the new migration in its `migrations`
  array per Task 2.2)
- Modify: `backend/test/live/manifest.json`
- Modify: `backend/README.md` (document the new endpoint's contract, extending the existing
  "Trust-tier model" and "Canonical payload contract" sections — using only guard-safe language:
  "signature valid/invalid", never "verified repo/secure/compliant")

**Step 1: Write failing e2e tests** covering, at minimum:
- Golden path: a verified-tier submission with `checks[]` is created, then `GET
  /submissions/:id/evidence` returns 200 with the exact stored payload + the registered public
  key; independently reconstructing `buildCanonicalPayload` from the response and calling
  `verifyEd25519` against the returned `signature` succeeds (this is the actual end-to-end
  cryptographic proof of the whole feature).
- 404 for an unknown submission id.
- 404 for a malformed (non-UUID) submission id (never 500).
- 404 for a private repo's submission when requested unauthenticated or by a non-owning account;
  200 when requested by the owning account (`Authorization: Bearer <apiKey>`).
- The response body's key set is exactly the whitelisted 13 fields — no extra keys (regression
  guard against a future accidental `{ ...submission }` reintroduction).

**Step 2: Run, verify fail** → **Step 3: nothing to implement (already done in 3.1/3.2)** — this
task should already pass once Tasks 3.1–3.2 land; if it doesn't, that's a real integration gap to
fix before moving on, not a plan deviation.

Run: `cd backend && npm run test:integration -- submissions-evidence.e2e-spec.ts`
Expected: PASS

**Step 4: Update `test/live/manifest.json`** — append to `proofScenarios`:

```json
{
  "name": "Golden path: a verified-tier submission with checks[] evidence can be independently re-verified end to end via GET /submissions/:id/evidence",
  "phase": "Evidence package",
  "script": null
},
{
  "name": "Negative path: GET /submissions/:id/evidence for a private repo's submission returns 404 to a non-owning/unauthenticated caller, 200 to the owner",
  "phase": "Evidence package",
  "script": null
}
```

**Step 5: Run the full local live proof**

Run: `cd backend && ./scripts/run-live-proof.sh`
Expected: exits 0, full e2e suite (including the new spec) passes against the compose-built stack.

**Step 6: Commit**

```bash
git add backend/test/e2e/submissions-evidence.e2e-spec.ts backend/test/live/manifest.json backend/README.md
git commit -m "test(backend): e2e coverage + live-proof scenarios for evidence endpoint"
```

---

## Phase 4: CLI — key management (`harnesslens keygen`)

> **Exit Criteria:** `harnesslens keygen` generates an Ed25519 keypair via `node:crypto`, writes
> the private key to `~/.harnesslens/signing-key.json` with `0600` permissions (directory `0700`),
> never overwrites an existing key without `--force`, and prints the public key + a copy-pasteable
> registration command. Zero new dependencies. `npm test` (CLI) passes.

### Task 4.1: `src/keys.ts` — pure keygen + key-file I/O

**Files:**
- Create: `src/keys.ts`
- Create: `src/keys.spec.ts`

**Step 1: Write failing tests**

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAndSaveSigningKey, loadSigningKey, SIGNING_KEY_RELATIVE_PATH } from './keys.js';

let tmpHome: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-keys-test-'));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('generateAndSaveSigningKey', () => {
  it('writes a signing-key.json with 0600 permissions and a 0700 parent directory', () => {
    const result = generateAndSaveSigningKey();
    const keyPath = path.join(tmpHome, SIGNING_KEY_RELATIVE_PATH);
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(keyPath)).mode & 0o777).toBe(0o700);
    expect(result.publicKeyBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(result.publicKeyBase64, 'base64').length).toBe(32);
  });

  it('never logs/returns the raw private key bytes in any printable summary field', () => {
    const result = generateAndSaveSigningKey();
    expect(Object.keys(result)).toEqual(['publicKeyBase64', 'keyFilePath']);
  });

  it('refuses to overwrite an existing key without force, fails loud with an actionable message', () => {
    generateAndSaveSigningKey();
    expect(() => generateAndSaveSigningKey()).toThrow(/already exists/i);
  });

  it('overwrites when force: true is passed', () => {
    const first = generateAndSaveSigningKey();
    const second = generateAndSaveSigningKey({ force: true });
    expect(second.publicKeyBase64).not.toBe(first.publicKeyBase64);
  });
});

describe('loadSigningKey', () => {
  it('loads a previously generated key and can produce a valid Ed25519 signature with it', () => {
    generateAndSaveSigningKey();
    const { privateKey } = loadSigningKey();
    expect(privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('throws an actionable error pointing at `harnesslens keygen` when no key file exists', () => {
    expect(() => loadSigningKey()).toThrow(/harnesslens keygen/);
  });
});
```

**Step 2: Run, verify fail**

Run: `npx vitest run src/keys.spec.ts`
Expected: FAIL — `./keys.js` does not exist.

**Step 3: Implement**

```ts
// src/keys.ts
import { createPrivateKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SIGNING_KEY_RELATIVE_PATH = path.join('.harnesslens', 'signing-key.json');

interface SigningKeyFile {
  algorithm: 'ed25519';
  privateKeyPkcs8Base64: string;
  publicKeyBase64: string;
  createdAt: string;
}

export interface GenerateSigningKeyResult {
  publicKeyBase64: string;
  keyFilePath: string;
}

function rawPublicKeyBase64(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function keyFilePath(): string {
  return path.join(os.homedir(), SIGNING_KEY_RELATIVE_PATH);
}

/** Generates an Ed25519 keypair and writes the private key to ~/.harnesslens/signing-key.json
 * (0600), creating the parent directory (0700) if needed. Never overwrites an existing key unless
 * `force: true` is explicitly passed -- losing a signing key silently would be unrecoverable for
 * whatever it was previously registered under. */
export function generateAndSaveSigningKey(opts: { force?: boolean } = {}): GenerateSigningKeyResult {
  const filePath = keyFilePath();
  if (fs.existsSync(filePath) && !opts.force) {
    throw new Error(`A signing key already exists at ${filePath}. Pass --force to overwrite it.`);
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const fileContents: SigningKeyFile = {
    algorithm: 'ed25519',
    privateKeyPkcs8Base64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKeyBase64: rawPublicKeyBase64(publicKey),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(fileContents, null, 2), { mode: 0o600 });
  // Explicitly chmod after write too: writeFileSync's `mode` option is only honored on file
  // *creation* -- if a prior write left looser permissions (e.g. --force overwrite of a file
  // whose mode had drifted), this guarantees 0600 regardless.
  fs.chmodSync(filePath, 0o600);

  return { publicKeyBase64: fileContents.publicKeyBase64, keyFilePath: filePath };
}

export interface LoadedSigningKey {
  privateKey: KeyObject;
  publicKeyBase64: string;
}

/** Never throws a raw fs error -- always a message pointing at `harnesslens keygen`. */
export function loadSigningKey(): LoadedSigningKey {
  const filePath = keyFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(
      `No signing key found at ${filePath}. Run \`harnesslens keygen\` first, then register the printed public key.`,
    );
  }
  const parsed = JSON.parse(raw) as SigningKeyFile;
  const privateKey = createPrivateKey({
    key: Buffer.from(parsed.privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return { privateKey, publicKeyBase64: parsed.publicKeyBase64 };
}
```

**Step 4: Run, verify pass**

Run: `npx vitest run src/keys.spec.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/keys.ts src/keys.spec.ts
git commit -m "feat(cli): add harnesslens keygen key management (src/keys.ts)"
```

### Task 4.2: Wire `keygen` into the CLI

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.spec.ts`

**Step 1: Write failing CLI tests** — append to `cli.spec.ts` (using the file's existing
`makeIO()` helper and a `tmpHome` pattern like Task 4.1's):

```ts
describe('harnesslens keygen', () => {
  it('prints the public key and a registration command, exits 0', async () => {
    const { io, stdoutLines } = makeIO();
    const result = await main(['keygen'], io);
    expect(result.exitCode).toBe(0);
    const out = stdoutLines.join('');
    expect(out).toContain('Public key (base64):');
    expect(out).toContain('signing-keys');
    expect(out).not.toMatch(/private/i); // never print the word "private key" value itself
  });

  it('exits 1 with an actionable message when a key already exists and --force is not passed', async () => {
    const { io: io1 } = makeIO();
    await main(['keygen'], io1);
    const { io: io2, stderrLines } = makeIO();
    const result = await main(['keygen'], io2);
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toMatch(/already exists/i);
  });
});
```

**Step 2: Run, verify fail**

Run: `npx vitest run src/cli.spec.ts -t keygen`
Expected: FAIL — `keygen` is not a recognized subcommand yet.

**Step 3: Implement** — in `src/cli.ts`:
- Add `'keygen'` and `'submit'` (Phase 5) and `'verify-package'` (Phase 6) to `ParsedArgs['subcommand']`.
- Add a `rest[0] === 'keygen'` branch in `parseArgs` (mirrors the existing `'multi'` branch).
- Add `runKeygenCommand(io)`:

```ts
import { generateAndSaveSigningKey } from './keys.js';

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
```
- Wire `--force` into `parseArgs` and dispatch `keygen` in `main()` before the existing
  `audit`/`multi` dispatch.
- Update the `HELP` constant to document `harnesslens keygen [--force]`.

**Step 4: Run, verify pass**

Run: `npx vitest run src/cli.spec.ts`
Expected: PASS (full file, no regressions)

**Step 5: Run the full CLI unit suite + certification-language guard**

Run: `npm test`
Expected: PASS, including `no-certification-claims.spec.ts` (new CLI help/output copy contains no
forbidden phrases — confirm by re-reading the printed strings above against the regex
`/\bcertified\b|\biso[- ]?compliant\b|\bverified\s+(harness|repo(?:sitory)?|secure|compliant)\b/i`;
none of the new copy uses those words).

**Step 6: Commit**

```bash
git add src/cli.ts src/cli.spec.ts
git commit -m "feat(cli): wire harnesslens keygen subcommand"
```

---

## Phase 5: CLI — evidence-package build, sign, submit (`harnesslens submit --sign`)

> **Exit Criteria:** `harnesslens submit <path> --sign --repo-id <org/repo> --commit-sha <sha>
> --key-id <uuid> --api-url <url>` runs a scan, builds the extended canonical payload (`checks[]`
> included, byte-identical to the backend's contract from Phase 1 — golden-file proven), signs it
> with the local key, and POSTs to `<api-url>/submissions`. `npm test` (CLI) passes.

### Task 5.1: `src/canonical-payload.ts` — CLI-local mirror + cross-package golden-file test

**Files:**
- Create: `src/canonical-payload.ts`
- Create: `src/canonical-payload.spec.ts`

**Step 1: Write failing tests** — this is the cross-package parity contract (Durable Decision 12).
Use the *exact same* fixture and golden strings as Phase 1's `canonical-payload.spec.ts` (Task
1.1) — copy them verbatim so a future accidental drift in either implementation is caught by a
literal string mismatch on both sides:

```ts
import { describe, it, expect } from 'vitest';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';

describe('buildCanonicalPayload (CLI) -- cross-package golden-file parity with backend/src/signing/canonical-payload.ts', () => {
  const baseFields: CanonicalSubmissionFields = {
    repoId: 'acme/widgets', score: 82.5, level: { index: 3, name: 'L3 Systematized' },
    dimensions: [{ id: 'ci', title: 'CI Coverage', earned: 8, max: 10, percent: 80 }],
    frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: '2026-08-13T00:00:00.000Z',
  };

  it('backward-compat golden string -- IDENTICAL to backend Task 1.1\'s golden string', () => {
    expect(buildCanonicalPayload(baseFields)).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"frameworkMapping":{},"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
  });

  it('checks[] golden string -- IDENTICAL to backend Task 1.1\'s golden string', () => {
    const fields: CanonicalSubmissionFields = {
      ...baseFields,
      frameworkMapping: { ci: { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI04', 'ASI08'] } },
      checks: [{ id: 'CTX-01', dimension: 'context', title: 'Has AGENTS.md', points: 5, earned: 5, passed: true, evidence: 'Found AGENTS.md at repo root' }],
    };
    expect(buildCanonicalPayload(fields)).toBe(
      '{"repoId":"acme/widgets","score":82.5,"level":{"index":3,"name":"L3 Systematized"},' +
        '"dimensions":[{"id":"ci","title":"CI Coverage","earned":8,"max":10,"percent":80}],' +
        '"checks":[{"id":"CTX-01","dimension":"context","title":"Has AGENTS.md","points":5,' +
        '"earned":5,"passed":true,"evidence":"Found AGENTS.md at repo root"}],' +
        '"frameworkMapping":{"ci":{"nistFunctions":["Measure","Manage"],"owaspIds":["ASI04","ASI08"]}},' +
        '"commitSha":"a1b2c3d","scannedAt":"2026-08-13T00:00:00.000Z"}',
    );
  });
});
```

**Step 2: Run, verify fail** → **Step 3: Implement** — copy `backend/src/signing/canonical-payload.ts`'s
`buildCanonicalPayload` implementation verbatim into `src/canonical-payload.ts` (same
`CanonicalSubmissionFields`/`CanonicalCheckField` types, same field-order logic, same conditional
`checks` inclusion), converting only the module's own doc comment to note it is the CLI-side
mirror of the backend file, per Durable Decision 12.

**Step 4: Run, verify pass**

Run: `npx vitest run src/canonical-payload.spec.ts`
Expected: PASS (2 tests, byte-identical to Phase 1's backend fixtures)

**Step 5: Also add local Ed25519 sign/verify helpers this file (or a sibling `src/ed25519.ts`)
needs** — mirror `backend/src/signing/ed25519.ts`'s `verifyEd25519` (needed by Phase 6's
`verify-package`) as `src/ed25519.ts` (export it as `verifyEd25519Raw` to avoid any naming
collision with a future re-export), with its own spec asserting a golden sign→verify round trip
using `node:crypto` directly (no backend import possible — same duplication rationale).

**Step 6: Commit**

```bash
git add src/canonical-payload.ts src/canonical-payload.spec.ts src/ed25519.ts src/ed25519.spec.ts
git commit -m "feat(cli): add canonical-payload + ed25519 mirrors (golden-file parity with backend)"
```

### Task 5.2: `src/evidence-package.ts` — build request body from a `Report`

**Files:**
- Create: `src/evidence-package.ts`
- Create: `src/evidence-package.spec.ts`

**Step 1: Write failing tests**

```ts
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSignedSubmissionBody } from './evidence-package.js';
import type { Report } from './types.js';

function fakeReport(): Report {
  return {
    tool: { name: 'harnesslens', version: '0.0.2' }, root: '/repo', truncated: false,
    scopes: { maturity: ['repo'], effective: ['repo'] }, gate: 'maturity', detectedHarnesses: [],
    level: { index: 3, name: 'L3 Systematized', nextLevelGaps: [] },
    score: { earned: 80, max: 100, percent: 80 },
    dimensions: [{ id: 'context', title: 'Context & Guides', earned: 8, max: 10, percent: 80 }],
    checks: [
      { id: 'CTX-01', dimension: 'context', title: 'Has AGENTS.md', points: 8, earned: 8, passed: true, evidence: 'Found', remediation: 'Add one', docsUrl: 'https://x' },
    ],
    effective: { level: { index: 3, name: 'L3 Systematized', nextLevelGaps: [] }, score: { earned: 80, max: 100, percent: 80 }, dimensions: [], checks: [], detectedHarnesses: [] },
    frameworkMapping: { context: { nistFunctions: ['Govern', 'Map'], owaspIds: ['ASI01', 'ASI06'] } },
  };
}

describe('buildSignedSubmissionBody', () => {
  it('maps Report.checks[] to the DTO shape, dropping remediation/docsUrl (Durable Decision 3)', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const body = buildSignedSubmissionBody(fakeReport(), {
      repoId: 'acme/widgets', commitSha: 'a1b2c3d', keyId: 'key-1', privateKey,
    });
    expect(body.checks).toEqual([
      { id: 'CTX-01', dimension: 'context', title: 'Has AGENTS.md', points: 8, earned: 8, passed: true, evidence: 'Found' },
    ]);
    expect((body.checks![0] as unknown as Record<string, unknown>).remediation).toBeUndefined();
    expect((body.checks![0] as unknown as Record<string, unknown>).docsUrl).toBeUndefined();
  });

  it('produces a signature that verifies against the exact canonical payload the backend would reconstruct', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const body = buildSignedSubmissionBody(fakeReport(), {
      repoId: 'acme/widgets', commitSha: 'a1b2c3d', keyId: 'key-1', privateKey,
    });
    // Re-derive the canonical string the same way the backend would from the POSTed body, and
    // verify locally -- proves the client and server would agree.
    const canonical = buildCanonicalPayloadFromBody(body);
    expect(verifyLocally(publicKey, canonical, body.signature!)).toBe(true);
  });

  it('sets repoId, score (from Report.score.percent), and scannedAt (ISO, defaults to now)', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const body = buildSignedSubmissionBody(fakeReport(), { repoId: 'acme/widgets', commitSha: 'a1b2c3d', keyId: 'key-1', privateKey });
    expect(body.repoId).toBe('acme/widgets');
    expect(body.score).toBe(80);
    expect(() => new Date(body.scannedAt)).not.toThrow();
  });
});
```

(`buildCanonicalPayloadFromBody`/`verifyLocally` are small test-local helpers reusing
`src/canonical-payload.ts`/`src/ed25519.ts` from Task 5.1 — write them inline in the spec file.)

**Step 2: Run, verify fail** → **Step 3: Implement**

```ts
// src/evidence-package.ts
import { sign, type KeyObject } from 'node:crypto';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';
import type { Report } from './types.js';

export interface SignedSubmissionBody {
  repoId: string; score: number; level: { index: number; name: string };
  dimensions: CanonicalSubmissionFields['dimensions'];
  checks?: CanonicalSubmissionFields['checks'];
  frameworkMapping: CanonicalSubmissionFields['frameworkMapping'];
  commitSha: string; scannedAt: string; keyId: string; signature: string;
}

export interface BuildSignedSubmissionOptions {
  repoId: string; commitSha: string; keyId: string; privateKey: KeyObject; scannedAt?: string;
}

export function buildSignedSubmissionBody(report: Report, opts: BuildSignedSubmissionOptions): SignedSubmissionBody {
  const scannedAt = opts.scannedAt ?? new Date().toISOString();
  const fields: CanonicalSubmissionFields = {
    repoId: opts.repoId,
    score: report.score.percent,
    level: { index: report.level.index, name: report.level.name },
    dimensions: report.dimensions.map((d) => ({ id: d.id, title: d.title, earned: d.earned, max: d.max, percent: d.percent })),
    checks: report.checks.map((c) => ({
      id: c.id, dimension: c.dimension, title: c.title, points: c.points, earned: c.earned, passed: c.passed, evidence: c.evidence,
    })),
    frameworkMapping: report.frameworkMapping as CanonicalSubmissionFields['frameworkMapping'],
    commitSha: opts.commitSha,
    scannedAt,
  };
  const canonical = buildCanonicalPayload(fields);
  const signature = sign(null, Buffer.from(canonical, 'utf8'), opts.privateKey).toString('base64');

  return { ...fields, keyId: opts.keyId, signature };
}
```

**Step 4: Run, verify pass** → **Step 5: Commit**

```bash
git add src/evidence-package.ts src/evidence-package.spec.ts
git commit -m "feat(cli): build+sign the evidence-package submission body from a Report"
```

### Task 5.3: `submit` subcommand — network POST + CLI wiring

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.spec.ts`

**Step 1: Write failing tests** — inject a fake `fetch` (module-level default parameter, override
in tests) rather than hitting the network:

```ts
describe('harnesslens submit --sign', () => {
  it('POSTs the signed body to <api-url>/submissions and prints the returned submission id', async () => {
    const { io, stdoutLines } = makeIO();
    // ... generate a key via keygen into tmpHome first, matching Task 4.1's setup pattern ...
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'sub-1', verified: true }) });
    const result = await main(
      ['submit', LEVEL_2_FIXTURE, '--sign', '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d', '--key-id', 'key-1', '--api-url', 'http://localhost:3000'],
      io, { fetchImpl: fakeFetch },
    );
    expect(result.exitCode).toBe(0);
    expect(fakeFetch).toHaveBeenCalledWith('http://localhost:3000/submissions', expect.objectContaining({ method: 'POST' }));
    expect(stdoutLines.join('')).toContain('sub-1');
  });

  it('exits 1 with an actionable error when --sign is omitted (Durable Decision 9)', async () => {
    const { io, stderrLines } = makeIO();
    const result = await main(['submit', LEVEL_2_FIXTURE, '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d'], io);
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toMatch(/--sign/);
  });

  it('exits 1 with an actionable error when no local signing key exists', async () => {
    const { io, stderrLines } = makeIO();
    const result = await main(['submit', LEVEL_2_FIXTURE, '--sign', '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d', '--key-id', 'key-1', '--api-url', 'http://x'], io);
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toMatch(/harnesslens keygen/);
  });

  it('exits 1 when the server rejects the submission (e.g. 400), surfacing the server\'s reason', async () => {
    const { io, stderrLines } = makeIO();
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'invalid signature' }) });
    const result = await main(
      ['submit', LEVEL_2_FIXTURE, '--sign', '--repo-id', 'acme/widgets', '--commit-sha', 'a1b2c3d', '--key-id', 'key-1', '--api-url', 'http://x'],
      io, { fetchImpl: fakeFetch },
    );
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('')).toContain('invalid signature');
  });
});
```

**Step 2: Run, verify fail** → **Step 3: Implement**
- Add a second optional parameter to `main(argv, io, deps?)` — `deps: { fetchImpl?: typeof fetch }
  = {}` — threading `deps.fetchImpl ?? fetch` down to the new `runSubmitCommand`. This keeps the
  established `main(argv, io)` test convention intact while making the network call injectable
  (mirrors `CliIO` being injectable for stdout/stderr).
- Add `--sign`, `--repo-id`, `--commit-sha`, `--key-id`, `--api-url` flags to `parseArgs` (fail
  loud, same `{ error: string }` pattern as existing flags, for any missing required value).
- `runSubmitCommand`: requires `--sign` (else error mentioning `--sign`); requires
  `--repo-id`/`--commit-sha`/`--key-id`/`--api-url` (else error naming the missing flag,
  fail-loud per this repo's `assertRequiredEnv`-style discipline — CLI-flag equivalent); calls
  `loadSigningKey()` (Task 4.1) — its own thrown error message already points at `harnesslens
  keygen`, propagate it as-is; runs `runAudit({root})`; calls `buildSignedSubmissionBody` (Task
  5.2); POSTs `JSON.stringify(body)` to `${apiUrl}/submissions` with
  `Content-Type: application/json`; on non-`ok` response, prints the server's `message` field to
  stderr and exits 1; on success prints the returned `id`/`verified` and exits 0.
- Update `HELP` to document `harnesslens submit <path> --sign --repo-id <org/repo> --commit-sha
  <sha> --key-id <uuid> --api-url <url>`.

**Step 4: Run, verify pass** → **Step 5: Run full CLI suite + no-certification-claims guard**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli.ts src/cli.spec.ts
git commit -m "feat(cli): wire harnesslens submit --sign subcommand"
```

---

## Phase 6: CLI — `verify-package`, docs, full live-proof pass

> **Exit Criteria:** `harnesslens verify-package <submission-id> --api-url <url>` fetches
> `GET /submissions/:id/evidence`, rebuilds the canonical string locally, verifies the signature,
> and prints a clear signature-valid/invalid result using only guard-safe language. `npm test`
> (both packages) and `./scripts/run-live-proof.sh` (backend) pass. Design's 5 Success Criteria
> are all demonstrable end to end against a local `docker compose up` backend.

### Task 6.1: `src/verify-package.ts`

**Files:**
- Create: `src/verify-package.ts`
- Create: `src/verify-package.spec.ts`

**Step 1: Write failing tests** — inject `fetchImpl`:

```ts
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyPackage } from './verify-package.js';
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';

function rawPublicKeyBase64(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

describe('verifyPackage', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const fields: CanonicalSubmissionFields = {
    repoId: 'acme/widgets', score: 80, level: { index: 3, name: 'L3' },
    dimensions: [], frameworkMapping: {}, commitSha: 'a1b2c3d', scannedAt: '2026-08-13T00:00:00.000Z',
  };
  const signature = sign(null, Buffer.from(buildCanonicalPayload(fields), 'utf8'), privateKey).toString('base64');

  it('reports valid: true for a genuinely matching signature + payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...fields, id: 'sub-1', verified: true, signature, keyId: 'key-1', publicKey: rawPublicKeyBase64(publicKey), checks: null }),
    });
    const result = await verifyPackage('sub-1', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(true);
  });

  it('reports valid: false when the evidence has been tampered with post-signing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...fields, commitSha: 'TAMPERED', id: 'sub-1', verified: true, signature, keyId: 'key-1', publicKey: rawPublicKeyBase64(publicKey), checks: null }),
    });
    const result = await verifyPackage('sub-1', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(false);
  });

  it('reports valid: false (never throws) when the submission is unsigned (no signature/publicKey at all)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...fields, id: 'sub-1', verified: false, signature: null, keyId: null, publicKey: null, checks: null }),
    });
    const result = await verifyPackage('sub-1', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unsigned/i);
  });

  it('surfaces a 404 as a clear not-found result, not a thrown error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await verifyPackage('does-not-exist', 'http://x', fetchImpl as unknown as typeof fetch);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });
});
```

**Step 2: Run, verify fail** → **Step 3: Implement**

```ts
// src/verify-package.ts
import { buildCanonicalPayload, type CanonicalSubmissionFields } from './canonical-payload.js';
import { verifyEd25519Raw } from './ed25519.js'; // Task 5.1's mirror of backend's verifyEd25519

export interface VerifyPackageResult {
  valid: boolean;
  reason?: string;
}

export async function verifyPackage(submissionId: string, apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<VerifyPackageResult> {
  const res = await fetchImpl(`${apiUrl}/submissions/${submissionId}/evidence`);
  if (!res.ok) {
    return { valid: false, reason: res.status === 404 ? 'submission not found' : `request failed (${res.status})` };
  }
  const body = (await res.json()) as CanonicalSubmissionFields & {
    signature: string | null; keyId: string | null; publicKey: string | null;
  };
  if (!body.signature || !body.publicKey) {
    return { valid: false, reason: 'submission is unsigned -- nothing to cryptographically verify' };
  }
  const canonical = buildCanonicalPayload(body);
  const valid = verifyEd25519Raw(body.publicKey, canonical, body.signature);
  return valid ? { valid: true } : { valid: false, reason: 'signature does not match the evidence payload (tampered, wrong key, or corrupted)' };
}
```

**Step 4: Run, verify pass** → **Step 5: Commit**

```bash
git add src/verify-package.ts src/verify-package.spec.ts
git commit -m "feat(cli): add verifyPackage (client-side signature + evidence-consistency check)"
```

### Task 6.2: `verify-package` subcommand wiring + guard-safe copy

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.spec.ts`

**Step 1: Write failing test**

```ts
describe('harnesslens verify-package', () => {
  it('prints "signature VALID" and exits 0 for a valid package', async () => {
    const { io, stdoutLines } = makeIO();
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => (/* valid fixture, see Task 6.1 */) });
    const result = await main(['verify-package', 'sub-1', '--api-url', 'http://x'], io, { fetchImpl: fakeFetch });
    expect(result.exitCode).toBe(0);
    expect(stdoutLines.join('')).toContain('signature VALID');
  });

  it('prints "signature INVALID" and exits 1 for a tampered package', async () => {
    const { io, stdoutLines } = makeIO();
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => (/* tampered fixture */) });
    const result = await main(['verify-package', 'sub-1', '--api-url', 'http://x'], io, { fetchImpl: fakeFetch });
    expect(result.exitCode).toBe(1);
    expect(stdoutLines.join('')).toContain('signature INVALID');
  });
});
```

**Step 2: Run, verify fail** → **Step 3: Implement** — add the `verify-package` branch to
`parseArgs`/`main`, print exactly:
- success: `` `harnesslens verify-package: signature VALID -- the evidence package matches what was signed.\n` ``
- failure: `` `harnesslens verify-package: signature INVALID -- ${result.reason}.\n` ``

Both strings avoid the word "verified" adjacent to "harness/repo/secure/compliant" and never say
"certified"/"ISO-compliant" — confirm against `no-certification-claims.spec.ts`'s regex by
re-reading it (Phase 1 of this section's own guard).

Update `HELP` to document `harnesslens verify-package <submission-id> --api-url <url>`.

**Step 4: Run, verify pass** → **Step 5: Run full CLI suite**

Run: `npm test`
Expected: PASS, including `no-certification-claims.spec.ts`.

**Step 6: Commit**

```bash
git add src/cli.ts src/cli.spec.ts
git commit -m "feat(cli): wire harnesslens verify-package subcommand"
```

### Task 6.3: Docs + final manual end-to-end proof

**Files:**
- Modify: `README.md` (document `keygen`/`submit --sign`/`verify-package`, guard-safe copy only)
- Modify: `ARCHITECTURE.md` (mark roadmap item 2 as delivered — signed evidence package
  infrastructure — and explicitly restate, in the same section, that harnesslens still computes no
  certification verdict of its own, matching the design's Purpose section almost verbatim but
  paraphrased to avoid triggering the same file's own guard if it happens to quote a forbidden
  phrase)
- Modify: `backend/README.md` (cross-link the new `GET /submissions/:id/evidence` contract, note
  the CLI now exists — remove/update the now-stale "A client SDK for submitters ... is separate"
  Out-of-scope line, since this plan builds exactly that)

**Step 1: Update docs** per the bullets above.

**Step 2: Run the full guard suite one more time**

Run: `npm test` (root CLI package)
Expected: PASS — `no-certification-claims.spec.ts` clean against the updated README.md/ARCHITECTURE.md.

**Step 3: Full manual end-to-end proof against a live local backend**

```bash
cd backend && docker compose up -d --wait
curl -sf http://localhost:3000/health/db

# From repo root, in a second shell:
node dist/cli.js keygen
# Manually run the printed curl command against a POST /accounts you create first, to get keyId.
node dist/cli.js submit test/fixtures/level-2 --sign --repo-id demo/widgets --commit-sha 0000000 \
  --key-id <keyId-from-registration> --api-url http://localhost:3000
node dist/cli.js verify-package <id-from-submit-output> --api-url http://localhost:3000

cd backend && docker compose down -v
```

Expected: `verify-package` prints `signature VALID`. This is the design's Success Criteria #1 and
#3 demonstrated end to end, live, against the real backend.

**Step 4: Commit**

```bash
git add README.md ARCHITECTURE.md backend/README.md
git commit -m "docs: document the signed evidence package CLI + endpoint (roadmap item 2)"
```

---

## Live Verification Strategy

- **Harness manifest:** `backend/test/live/manifest.json` (existing, extended in Task 3.3).
- **Setup:** `cd backend && npm ci && docker compose build` (existing `manifest.json.setup`).
- **Reset:** `docker compose down -v && docker compose up -d --wait` (existing).
- **Health:** `GET http://localhost:3000/health/db` (existing).
- **Cleanup:** `docker compose down -v --remove-orphans` (existing).
- **First-party boundary:** the entire feature is first-party (backend NestJS app + CLI Node
  process) — no external services. The only "external" edge is the CLI's `fetch` call to the
  backend, which is itself brought up by the harness.
- **Named proof scenarios (new, appended to `proofScenarios` in Task 3.3):**
  - *Given* a registered account + signing key, *when* a `checks[]`-carrying signed submission is
    POSTed and then fetched via `GET /submissions/:id/evidence`, *then* independently
    reconstructing the canonical payload and verifying the returned signature succeeds.
  - *Given* a private repo's submission, *when* `GET /submissions/:id/evidence` is called
    unauthenticated or by a non-owning account, *then* it 404s identically to an unknown id;
    *when* called by the owning account, *then* it 200s with the full evidence.
- **Stress:** not required for this feature — `checks[]` is a read/write extension of an
  already-stress-tested write path (`POST /submissions`, already covered by the existing
  `submission-burst` stress scenario); no new concurrency surface is introduced.
- **Manual end-to-end proof:** Task 6.3, Step 3 (full `keygen` → register → `submit --sign` →
  `verify-package` round trip against a live local `docker compose` backend).

---

## Relevant Codebase Files

### Patterns to Follow
- `backend/src/signing/canonical-payload.ts` — the exact pattern being extended (fixed key order,
  server-reconstructed-only discipline, Durable Decision 10 from the prior build).
- `backend/src/submissions/dto/create-submission.dto.ts:14-20` (`DimensionDto`) — the class shape
  `CheckDto` mirrors.
- `backend/src/submissions/submissions.service.ts:56-117` (`buildInsertableSubmission`) — the
  field-by-field-reconstruction, dangerous-key, and verified-tier-branching pattern `checks[]`
  extends.
- `backend/src/query/query.controller.ts:26-77` — the private-vs-never-existed 404
  indistinguishability pattern the new evidence endpoint reuses.
- `backend/src/migrations/1786633235167-InitSchema.ts` + its 14 test-file consumers — the
  migration-wiring pattern Task 2.2 must replicate exactly.
- `src/api.ts` / `src/cli.ts` — the pure-function-module vs. thin-CLI-wrapper split every new CLI
  file (`keys.ts`, `canonical-payload.ts`, `evidence-package.ts`, `verify-package.ts`) follows.
- `src/harness/global-paths.ts:1-10` — this repo's only existing `os.homedir()` precedent.

### Configuration Files
- `backend/tsconfig.json` — do not touch; `checks` column/DTO additions don't need config changes.
- `tsconfig.lib.json` — new `src/*.ts` files are auto-included via its `include: ["src/**/*.ts"]`.

### Related Documentation
- `docs/plans/2026-08-19-evidence-package-design.md` — full design (source of truth for scope).
- `docs/decisions/2026-08-14-verified-tier-signing-key-trust-boundary-decision.md` — the
  account-binding precedent this plan's Durable Decision 7 (private-repo evidence isolation)
  directly extends.
- `backend/README.md` "Canonical payload contract" and "Trust-tier model" sections — update in
  Task 3.3/6.3, don't contradict.
- `src/no-certification-claims.spec.ts` — the forbidden-phrase guard every new CLI string (and,
  manually, every new backend string, since the guard doesn't scan `backend/`) must stay clear of.

---

## Risks

| Risk | P | I | Score | Mitigation |
|------|---|---|-------|------------|
| Canonical payload backward-compat regression breaks every existing verified-tier signer | 2 | 5 | 10 | Task 1.1's hardcoded golden-string regression test locks the no-`checks[]` byte output; run it before any other Phase 1 work is considered done. |
| CLI and backend canonical-payload implementations silently drift (two hand-maintained copies, no shared import) | 3 | 4 | 12 | Task 5.1's golden-file test uses the *literal same* hardcoded strings as Task 1.1; any future edit to either file that isn't mirrored in the other breaks a test immediately, in CI, on the changed side. |
| Migration adds `checks` column but one of the 14 test-file `migrations` arrays is missed, causing a flaky/hard-to-diagnose "column does not exist" failure in only that spec | 3 | 3 | 9 | Task 2.2 lists all 14 files explicitly by path; run the full `npm run test:integration` (not a single spec) before committing Phase 2. |
| New `GET /submissions/:id/evidence` endpoint leaks a private repo's evidence (regression of the twice-hardened tenant-isolation model) | 2 | 5 | 10 | Durable Decision 7 + Task 3.1's explicit private-repo test cases (own-account 200, non-owner/unauthenticated 404) plus Task 3.3's e2e coverage of the same. |
| Malformed submission-id path param crashes the new endpoint to 500 (same bug class already found once in this codebase) | 3 | 3 | 9 | Durable Decision 8 + Task 3.1's explicit non-UUID test asserting `findOne` is never called. |
| `SubmissionRejectionFilter`'s blanket `@Catch()` audits the new GET route's ordinary 404s as `rejected_submissions` rows | 3 | 2 | 6 | Task 3.2's Step 3 explicitly calls out verifying this in the e2e test and scoping the filter down to `@Post()` only if it misbehaves. |
| Backend's own new copy (README, error messages) drifts into forbidden certification language with no automated guard (the existing spec only scans CLI `src/` + root docs) | 2 | 3 | 6 | Task 3.3/6.3 manually re-check new backend copy against the exact regex before committing; noted explicitly as an unguarded gap in this plan rather than silently assumed covered. |
| CLI's first-ever network code (`submit`, `verify-package`) has no prior test-injection convention in this codebase to follow | 2 | 2 | 4 | `main(argv, io, deps)`'s new optional `deps.fetchImpl` parameter is additive-only (existing 2-arg call sites unaffected) and mirrors the already-established `io` injection pattern exactly. |

---

## Success Criteria

- [ ] `cd backend && npm test && npm run test:integration` pass with 0 failures.
- [ ] `npm test` (CLI, root) passes with 0 failures, including `no-certification-claims.spec.ts`.
- [ ] `cd backend && ./scripts/run-live-proof.sh` exits 0.
- [ ] Manual end-to-end proof (Task 6.3, Step 3) demonstrates: keygen → registration → signed
      `submit` with `checks[]` → `verify-package` prints `signature VALID`, against a live local
      backend.
- [ ] A pre-existing verified-tier signature (computed against the pre-extension canonical
      payload) still verifies successfully post-migration (Task 1.1's regression test).
- [ ] No component's new copy (CLI help/output, backend README/error messages) contains
      "certified", "ISO-compliant", or "verified harness/repo/secure/compliant" language.
- [ ] `GET /submissions/:id/evidence` never returns evidence for a private repo to a non-owning or
      unauthenticated caller (e2e-proven, Task 3.3).
