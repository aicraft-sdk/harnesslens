# Signed Evidence Package Design

## Purpose

harnesslens today produces a maturity score (L0–L4) but deliberately makes no certification
claim of its own — `no-certification-claims.spec.ts` forbids language like "certified",
"ISO-compliant", or "verified harness/repo/secure/compliant" anywhere in shipped copy. Roadmap
item 2 ("formal ISO/accreditation-style certification") asked what an actual accredited
pass/fail mechanism would look like.

The answer this design settles on: harnesslens does not become an accrediting body, and it
never computes or claims a pass/fail verdict. Instead it produces a **signed evidence
package** — a cryptographically verifiable, per-check evidence trail (not just an aggregate
score) that a real external accrediting body, or a customer's own auditor, could consume to
make *their own* pass/fail/certification decision. This reuses the Ed25519 signed-attestation
infrastructure the live backend already ships (`verified`-tier submissions), extended with
finer-grained evidence and a way to verify a package independently.

## Users

- Repo owners who want a portable, tamper-evident proof of their harnesslens scan results to
  hand to an auditor, customer, or compliance reviewer — not just a self-reported number.
- A future external accreditor or auditor consuming the package to independently verify claims
  without re-running harnesslens themselves.

## Success Criteria

- [ ] A repo owner can generate an Ed25519 keypair via the CLI, scan their repo, and produce a
      signed evidence package (per-check evidence + score) submitted to the live backend.
- [ ] The package includes per-check evidence (id, title, dimension, pass/fail, evidence text,
      points/earned) — not just the existing dimension-level rollup.
- [ ] A third party can verify a package's signature and confirm the evidence matches the
      claimed score, without trusting the submitter's word for it.
- [ ] No component (CLI output, backend response, docs) computes, stores, or displays a
      pass/fail/"certified" verdict of harnesslens's own — evidence only.
- [ ] `no-certification-claims.spec.ts` still passes unmodified; all new copy stays inside its
      existing forbidden-phrase boundaries.

## Constraints

- Reuse the live backend's existing Ed25519 signing/verification infrastructure
  (`backend/src/signing/*`, `backend/src/signing-keys/*`) rather than inventing a parallel
  scheme.
- CLI additions must preserve the zero-runtime-dependency convention (`"dependencies": {}`) —
  no new npm packages for keygen/signing; Node's built-in `node:crypto` already supports
  Ed25519 keygen and signing.
- The backend's canonical-payload signing discipline (server always reconstructs the canonical
  string itself, never trusts a client-supplied one — Durable Decision 10) must extend to the
  new `checks[]` field, not bypass it.
- Must not touch `no-certification-claims.spec.ts`'s forbidden-phrase regex.

## Out of Scope

- Onboarding or integrating with any actual external accrediting body — this ships the
  mechanics only.
- Any human review/audit workflow or reviewer role.
- A pass/fail threshold computed or published by harnesslens itself, even a "neutral" one.
- OS-keychain or CI-secret-manager key storage — local file storage only for this pass.
- A public web UI for browsing/verifying packages — the verify surface is programmatic
  (CLI command + backend endpoint) for now.

## Approach Chosen

Extend the existing verified-tier submission path end-to-end rather than building a parallel
mechanism:

1. **CLI key management** (new): `harnesslens keygen` generates an Ed25519 keypair via
   `node:crypto`, stores the private key at `~/.harnesslens/signing-key.json` (0600), and
   prints the public key + a suggested `signing-keys` registration command.
2. **CLI evidence-package generation** (new): a new `--sign` flag (or `harnesslens submit
   --sign`) takes the already-computed `Report` (which already contains `checks: CheckResult[]`
   with full per-check evidence — no scan-side changes needed), builds an extended canonical
   payload that includes `checks[]` alongside the existing `dimensions[]`, signs it with the
   local key, and POSTs it to `POST /submissions`.
3. **Backend payload extension**: `CreateSubmissionDto` gains an optional `checks[]` array
   (mirrors `CheckResult`'s public fields: id, dimension, title, points, earned, passed,
   evidence — remediation/docsUrl excluded as redundant with the public checks registry).
   `buildCanonicalPayload` includes `checks[]` (fixed field order, same discipline as
   `dimensions[]`) so a submission with per-check evidence can't have that evidence stripped
   or altered without invalidating the signature.
4. **Storage**: `Submission` entity gains a `checks` JSON column, written whenever a signed
   submission includes it.
5. **Verify surface**: `GET /submissions/:id/evidence` returns the full canonical payload,
   signature, keyId, and the registered public key, so a third party can independently
   reconstruct the canonical string and verify the signature without trusting the API's own
   "verified: true" flag. A matching CLI convenience command, `harnesslens verify-package
   <submission-id>`, does the same round-trip and prints a clear PASS/FAIL on signature +
   evidence-consistency (this is a cryptographic verification verdict — "does this signature
   match this payload" — never a certification/compliance verdict, and its copy must stay
   within the existing guard).

Rejected alternative: a standalone offline CLI-only signer with no backend involvement. This
would duplicate the backend's signing-key registration/revocation infrastructure and produce
keys with no registered identity behind them — a verifier would have no way to know a key
belongs to who it claims to.

## Architecture

```
 CLI (repo owner)                     Backend (existing + extended)
 ─────────────────                    ──────────────────────────────
 harnesslens keygen                   POST /accounts/:id/signing-keys
   → ~/.harnesslens/signing-key.json    (existing — registers pubkey)
                                                │
 harnesslens scan → Report                     │
   (checks[] already present)                  │
        │                                       │
        ▼                                       │
 build extended canonical payload               │
   (dimensions[] + checks[] + ...)              │
        │                                       │
        ▼                                       │
 sign with local Ed25519 key                    │
        │                                       ▼
        └──────────────► POST /submissions (extended DTO: + checks[])
                             │
                             ▼
                   verifySignedSubmission (extended:
                   canonical payload now includes checks[])
                             │
                             ▼
                   Submission row (+ checks JSON column)
                             │
        ┌────────────────────┴────────────────────┐
        ▼                                          ▼
 GET /submissions/:id/evidence            harnesslens verify-package <id>
 (raw payload + signature + pubkey)          (fetches above, re-verifies locally)
```

## Components

- `src/keys.ts` (new, CLI): Ed25519 keygen, local key file read/write, permission checks.
- `src/evidence-package.ts` (new, CLI): builds the extended canonical payload from a `Report`,
  signs it, shapes the `POST /submissions` request body.
- `src/verify-package.ts` (new, CLI): fetches `GET /submissions/:id/evidence`, rebuilds the
  canonical string client-side, verifies the signature, reports evidence-consistency.
- `backend/src/submissions/dto/create-submission.dto.ts`: add optional `checks[]` (mirrors
  existing `DimensionDto` validation pattern — one nested DTO class, `@IsArray()
  @ValidateNested({ each: true })`).
- `backend/src/signing/canonical-payload.ts`: extend `CanonicalSubmissionFields` +
  `buildCanonicalPayload` with `checks[]`, fixed field order.
- `backend/src/submissions/entities/submission.entity.ts` + a new migration: `checks` JSON
  column (nullable — absent for basic/verified-without-evidence submissions).
- `backend/src/submissions/submissions.controller.ts`: new `GET /submissions/:id/evidence`
  route.

## Data Flow

1. Repo owner runs `harnesslens keygen` once; registers the printed public key via the
   existing `POST /accounts/:id/signing-keys` (already built, Phase 3 of the live-backend
   work).
2. Repo owner runs `harnesslens scan --sign` (or equivalent). The CLI computes the `Report` as
   today (no scan-engine changes — `checks: CheckResult[]` already exists), then builds the
   canonical payload including both `dimensions[]` and the new `checks[]`, signs it with the
   local private key, and POSTs to `POST /submissions` with `keyId` + `signature` +  `checks[]`
   included in the body.
3. Backend reconstructs the canonical payload server-side (now including `checks[]`, same
   "never trust a client-supplied canonical string" discipline as today) and verifies the
   signature exactly as it does today for `dimensions[]`-only submissions. On success, stores
   the row including the new `checks` column.
4. Anyone with the submission id calls `GET /submissions/:id/evidence` to retrieve the full
   payload + signature + the registered public key for that `keyId`.
5. `harnesslens verify-package <id>` (or any independent Ed25519 implementation) rebuilds the
   canonical string from the returned payload and verifies the signature locally — proving the
   evidence hasn't been altered since signing, without trusting the backend's own claim.

## Error Handling

- Malformed/tampered `checks[]` entries (e.g. a `__proto__` id) are rejected with the same
  `isDangerousKey` fail-closed check `dimensions[]` already uses today — extend the existing
  loop to also scan `checks[].id`.
- A signature that verifies against `dimensions[]` alone but not the extended
  `dimensions[]+checks[]` payload (e.g. a submitter who signed an older payload shape, or
  tampering) is rejected outright — same `INVALID_SIGNATURE_REASON` generic rejection as today,
  never a partial/downgraded acceptance.
- Local key file missing when `--sign` is used: CLI fails fast with an actionable message
  pointing at `harnesslens keygen`, never silently falls back to an unsigned submission.
- `GET /submissions/:id/evidence` for a submission with no `checks[]` (basic or
  verified-without-evidence) returns the payload it has (`checks: null`) — verification still
  covers signature validity over whatever was actually signed; it does not fabricate evidence
  that was never submitted.

## Testing Strategy

- Backend: extend the existing `submissions.service.spec.ts` Ed25519 golden-path test to cover
  `checks[]` in the canonical payload; add a tamper test (checks[] evidence text altered
  post-signing → signature must fail).
- Backend: `isDangerousKey` fail-closed test for `checks[].id`, mirroring the existing
  `dimensions[].id` test.
- Backend: new `GET /submissions/:id/evidence` integration test — returns exactly what was
  stored, 404 for unknown id.
- CLI: unit tests for `src/keys.ts` (keygen produces a valid Ed25519 pair, file permissions),
  `src/evidence-package.ts` (canonical payload shape matches backend's field order exactly —
  golden-file style, since a mismatch would produce a payload the backend can never verify),
  `src/verify-package.ts` (accepts a known-good fixture, rejects a tampered one).
- `no-certification-claims.spec.ts` must still pass unmodified against all new CLI/backend
  copy (help text, `verify-package` output, README additions).

## Questions Resolved

- Q: What kind of "certification" should this actually be?
  A: Evidence infrastructure only — harnesslens never claims to certify anything; it produces
     signed evidence a future external party could use.
- Q: What should the evidence package contain?
  A: Per-check evidence (id, pass/fail, evidence text) + score — not a full repo snapshot/hash.
- Q: Does harnesslens compute any pass/fail verdict?
  A: No — evidence only, no threshold flag of any kind.
- Q: Delivery mechanism — extend the live backend's attestation, or a standalone offline
    signer?
  A: Extend the live backend's existing Ed25519 attestation/submission flow.
- Q: Include a verification surface now, or defer it?
  A: Include a minimal verify mechanism now (CLI command + backend endpoint).
- Q: Is building the CLI's first-ever signing/submission capability (the "client SDK" the
    backend README calls out as separate/future work) in scope?
  A: Yes — without it there is no usable end-to-end path.
- Q: Where should the CLI store the local private key?
  A: Plain file under `~/.harnesslens/` (0600), consistent with the project's
     zero-runtime-dependency convention.
- Q: Should `no-certification-claims.spec.ts`'s regex be touched if new copy needs it?
  A: No — work within the existing guard unchanged.
