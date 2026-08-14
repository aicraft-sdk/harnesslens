# Verified-tier signing-key trust boundary (Phase 3)

## What Changed

Phase 3 of the live-hosted-backend build (`docs/plans/2026-08-13-live-hosted-backend-execution-plan.md`)
shipped the "verified" trust tier end-to-end: `POST /accounts` issues a random 32-byte API key
once, persisting only its SHA-256 hash (`accounts.api_key_hash`); `ApiKeyGuard` authenticates
account-scoped writes by re-hashing the bearer token and matching it against that column;
`POST/DELETE /accounts/:accountId/signing-keys` register and revoke Ed25519 public keys scoped to
the authenticated account (revocation is a single scoped `UPDATE ... WHERE accountId AND keyId`,
so a `keyId` that doesn't exist and a `keyId` belonging to another account both produce the same
`404`); and `POST /submissions` now accepts an optional `keyId`/signature pair, verifying it with
`verifyEd25519` against a canonical payload the server always rebuilds itself from
already-validated submission fields (`buildCanonicalPayload`) — the server never accepts a
client-supplied canonical string as verification input.

This was a HITL checkpoint phase. The human reviewer's security re-hunt found two real CRITICAL
bugs across two remediation cycles before sign-off:

1. **Cross-account signing-key forgery.** `verifySignedSubmission` originally looked up
   `signing_keys` globally by `keyId` with no check that the key's owning account matched the
   repo's owning account — any registered signing key could produce `verified: true` for any
   other org's `repoId`. Fixed by resolving the repo's account via
   `ReposService.findOrCreateForSubmission` and requiring `signingKey.accountId === repo.accountId`
   before verification can succeed, failing closed with the same generic rejection reason used
   for every other verification failure (commit `f8ab78e`).
2. **Org-account-squatting via the first fix's own write.** That fix's account resolution called
   `findOrCreateForSubmission`, a side-effecting auto-provisioning write, reachable even for a
   forged/rejected submission against a `repoId` whose org had never registered — permanently
   squatting `accounts.org_name` (unique) and blocking the real org from ever completing
   `POST /accounts`. Fixed by making the verified-tier account-resolution lookup read-only
   (`accountsRepo.findOneBy` / `reposRepo.findOneBy`, no provisioning call) — a legitimate
   verified-tier submission's account must already exist, since `SigningKeysController` never
   auto-provisions and a signing key can only be registered against an already-real,
   `POST /accounts`-created account.

## Why

The verified tier's entire value proposition is that `verified: true` is a trustworthy claim —
if any registered key could forge that claim for another org's repo, the tier would be worse than
no tier at all (false confidence). Binding signing keys to their owning account at verification
time is the minimum bar for that claim to mean anything. The follow-up fix was necessary because
the first fix's own remediation path introduced a second, independent way to damage another org
(denial of registration via squatting) — read-only account resolution closes that path without
reintroducing the original forgery bug, because a legitimate verified-tier account is guaranteed
to already exist by construction (signing keys cannot be registered against a not-yet-real
account).

## Alternatives Considered

- **Trust the client-supplied `keyId` alone (no account-binding check):** rejected outright —
  this is the CRITICAL bug itself, not a real alternative; any registered key could forge
  verification for any org.
- **Keep auto-provisioning in the verified-tier resolution path but suppress the write on
  rejection:** considered, but more complex (would need a rollback or a dry-run variant of
  `findOrCreateForSubmission`) for no benefit over simply never provisioning in a read path in the
  first place; read-only resolution is simpler and strictly safer.
- **Distinguish "wrong account" rejections from other verification failures for easier client
  debugging:** rejected — would create a timing/response oracle letting a caller enumerate which
  orgs exist or which signing keys are valid, violating this codebase's established
  indistinguishability discipline (see the private-vs-never-existed 404 precedent from Phase 2).

## Impact

- **Who is affected:** any future client integrating the verified tier — signing keys must be
  registered under the exact account that owns the target repo's org, and `POST /accounts` must
  happen before `POST /submissions` with a `keyId` for that org (verified-tier submissions never
  auto-provision an account).
- **Migration:** none — no prior verified-tier consumers existed; this is the tier's first real
  implementation, not a change to already-shipped behavior.
- **Ongoing maintenance:** any future endpoint that resolves an account/repo as part of an
  authorization or verification decision (not a legitimate provisioning trigger) must use a
  read-only lookup, never a side-effecting `findOrCreate` — this is now the second independently
  discovered instance of a side-effecting write reachable from a path that should be read-only
  (see `.craftflow/state/project/patterns.md` "Cross-phase synthesis" note on side-effecting DB
  writes recurring ungated in this backend's request lifecycle).
