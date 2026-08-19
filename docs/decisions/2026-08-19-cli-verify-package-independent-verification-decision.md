# CLI independent evidence-package verification (`harnesslens verify-package`, Phase 6)

## What Changed

Phase 6 of `docs/plans/2026-08-19-evidence-package-plan.md` added `harnesslens verify-package
<submission-id> --api-url <url>` (`src/verify-package.ts`, wired into `src/cli.ts`). It fetches
`GET /submissions/:id/evidence`, rebuilds the exact same canonical payload string locally from the
returned fields (`buildCanonicalPayload`, mirroring the backend's fixed key order — including each
`frameworkMapping` entry's nested `nistFunctions, owaspIds` order, since a value read back from a
`jsonb` column does not preserve original key insertion order), and independently checks the
Ed25519 signature against the returned public key — it never trusts the backend's own `verified`
boolean. It prints `signature VALID` (exit 0) or `signature INVALID -- <reason>` (exit 1).

Five remediation cycles hardened this against a malformed or adversarial server response: guarding
`fetch`/`res.json()` failures, an unsigned submission, a missing-required-field body (unguarded
`buildCanonicalPayload` throw), a malformed/non-base64 `publicKey` (unguarded `createPublicKey`
throw), a literal JSON `null` body, and a JSON-array body (`typeof [] === 'object'` bypassing the
null/object guard) — every one of these now returns a structured `{ valid: false, reason }` instead
of crashing or reporting a false success. The same defensive pattern was mirrored in
`runSubmitCommand` (`src/cli.ts`) for `submit`'s response handling.

## Why

The evidence package's entire value proposition is that a third party can independently confirm a
submission's signature holds, without having to trust `harnesslens` or the backend's own claim
about it. If `verify-package` simply echoed the backend's `verified` field, a compromised or buggy
backend could assert a false positive with no independent check possible — the command would add
no value over just reading the field directly. Rebuilding the canonical payload and checking the
signature client-side is the only way this guarantee is real. Because the input to that
recomputation is always an untrusted HTTP response (network failure, malformed JSON, wrong shape,
adversarial body), every synchronous step that touches it needed an explicit guard — an unguarded
throw crashing the CLI, or a guard that silently produces a false `exit 0` success, is as bad as no
verification at all for a tool whose purpose is trustworthy verification.

## Alternatives Considered

- **Trust the backend's `verified` boolean directly (no client-side recomputation):** rejected —
  defeats the purpose of independent verification; a compromised or buggy backend could assert a
  false `verified: true` with no way for a caller to catch it.
- **Let response-parsing/shape errors propagate as raw exceptions:** rejected — a raw stack trace
  from a 200 OK response with an unexpected body is indistinguishable from a real crash bug to the
  caller, and CI/scripting callers need a stable `{ valid: false, reason }` contract, not an
  uncaught exception, to make signature verification distinguishable from "the network broke."
- **Treat `typeof body === 'object'` as sufficient for "is a JSON object":** rejected once found in
  remediation cycle 5 — `typeof [] === 'object'` in JS, so this let a JSON-array response body
  bypass the malformed-response guard; `Array.isArray()` is required alongside the `typeof`/`null`
  checks.

## Impact

- **Who is affected:** anyone consuming `harnesslens submit`/`verify-package` against a live
  backend, including scripted/CI callers relying on the exit code and `reason` string rather than
  a raw stack trace.
- **Migration:** none — `verify-package` is a new, opt-in subcommand; no existing command's
  behavior changed.
- **Ongoing maintenance:** any future code path that touches an HTTP response body from this
  backend (or any untrusted server) before using it must apply the same
  `try/catch` + `null`/`typeof !== 'object'`/`Array.isArray()` guard pattern established here in
  `src/cli.ts` and `src/verify-package.ts` — five separate crash/false-success sites were found and
  fixed incrementally across Phase 6's review/hunt cycles by not applying this pattern
  consistently the first time.
