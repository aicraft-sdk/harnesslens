# Live Hosted Backend Design

## Purpose
harnesslens today ships a zero-network, build-time-only scorer (CLI/Action/badge) plus a
static, PR-gated leaderboard (`leaderboard/`). This is item 1 of the ARCHITECTURE.md "Future
direction" list: a live, hosted, queryable scoring service — the product's path toward the
category leaders it's most comparable to (OpenSSF Scorecard, Socket.dev, Snyk Advisor), which
succeed specifically because they're live and API-backed rather than periodic/static.

## Users
External consumers, not just the `@ai-craft` org internally. A real multi-tenant public
service: any org/repo can submit and query scores (once the package itself is public), not
just an internal dashboard.

## Success Criteria
- [ ] A saved decision RFC exists comparing viable architecture options for this backend
- [ ] The RFC recommends a direction with rationale, grounded in this repo's actual context
      (ARCHITECTURE.md, the leaderboard's existing trust-boundary design, its allowlist-parser
      decision doc) rather than generic boilerplate options
- [ ] The RFC stays scoped to item 1 only

This planning pass produces the **RFC**, not an execution plan. Build decisions come after the
user reviews the RFC and picks a direction.

## Constraints
- Must be additive: the existing zero-network scorer/CLI/Action and the static, PR-gated
  leaderboard are not modified. This is a new, separate surface.
- Packaging assumption for this RFC: containerized (Dockerfiles / docker-compose or similar) —
  the actual hosting/cloud-provider decision (where those containers run) is explicitly
  deferred to a later conversation. The RFC should design for portability across hosts rather
  than committing to a specific provider.

## Out of Scope
- Items 2-4 of the ARCHITECTURE.md "Future direction" list (formal certification,
  `runMultiRepoAudit` relationship, plugin-shaped-repo detection gap)
- Implementing or deploying the backend
- Choosing a specific hosting provider/region (deferred)
- Embeddable live badge rendering (flagged as a fast-follow, not core RFC scope)

## Approach Chosen
**Option A — full live, multi-tenant scoring API + DB**, with signed attestations built in as
an integrated trust tier (not a separate, narrower attestation-only service). Rejected
alternatives, kept in the RFC as documented alternatives:
- *Attestation-verification-only service, static leaderboard untouched* — smaller diff, but
  caps the product at "verify one claim at a time" rather than becoming a real live, queryable
  platform. Rejected because the user explicitly asked to optimize for product ceiling, not
  amount of change.
- *Fully external managed BaaS (Supabase/Firebase, etc.)* — fastest to stand up, but weakest
  fit with this repo's pattern of owning its trust model explicitly (see the leaderboard's own
  allowlist-parser decision doc) and least suited to "tiered public/private scoring."

## Architecture
A new, standalone live service alongside (not replacing) the existing scorer and static
leaderboard.

- **Multi-tenant, queryable scoring API.** Orgs/repos submit scan results live (no PR) and
  query current + historical scores.
- **Two trust tiers:**
  - *Basic* — live-submitted, unsigned, shown with a "self-reported" badge (same trust level
    as today's leaderboard, just live instead of batch).
  - *Verified* — submitter signs the payload with a registered keypair; the API verifies the
    signature before marking it "verified." This is the concrete realization of
    ARCHITECTURE.md's "signed/verifiable attestations" phrase.
- **Public/private tiering** — public repos land on a public, queryable leaderboard (successor
  to the static one); private orgs score private repos visible only to their own account.
- **Historical time-series, not just latest** — every submission stored immutably, enabling
  trend queries and score-regression CI gates (a real unlock a static site can't offer).
- **Packaging:** containerized services (Dockerfiles), portable across hosts. Hosting
  provider/deployment target is an explicit open question for a future conversation, not this
  RFC.

## Components
1. **Submission API** (write path) — auth, rate limiting, signature verification, persists to
   store.
2. **Query API** (read path) — public queries unauthenticated for public-tier data;
   authenticated for private-tier + historical/trend endpoints.
3. **Data store** — time-series source of truth for this new surface.
4. **Identity/key registry** — maps accounts to registered signing keys (verified tier) and to
   repo visibility (public/private tier).
5. *(Fast-follow, not core RFC scope)* Live embeddable badge renderer reading off the Query
   API.

## Data Flow
Submitter's own CI (same submit-workflow pattern as today's leaderboard) -> POST to Submission
API (optionally signed) -> schema-allowlist validation (same discipline as `parseSubmission`
today) + signature check if present -> persisted as a new time-series row -> immediately
queryable.

## Error Handling
Malformed/rate-limited submissions rejected with a clear reason, never silently dropped
(mirrors the leaderboard's existing "skipped with reason" philosophy). An invalid signature is
rejected outright — never silently downgraded to "unverified," which would let a spoofed
signature masquerade as legitimate.

## Testing Strategy
Deferred to the execution-plan stage after the RFC's direction is chosen.

## Questions Resolved
- Q: What does done look like for this planning pass?
  A: A decision RFC, not a full execution plan — direction gets chosen after review.
- Q: What must not change or break?
  A: Existing zero-network scorer and static PR-gated leaderboard stay untouched; new backend
     is purely additive.
- Q: Where does this end?
  A: Item 1 only, RFC-level only (no implementation, no other roadmap items, no hosting
     decision).
- Q: Who is this primarily for?
  A: External consumers too — a real multi-tenant public service, not an internal-only tool.
- Q: Amount-of-change vs. product-ceiling tradeoff (A vs. B vs. C)?
  A: Optimize for product ceiling. Chose Option A (full live API), with signed attestations as
     a trust tier within it rather than a separate, narrower service.
- Q: Deployment packaging for this RFC?
  A: Assume containerized (Docker); hosting-provider choice is deferred to a later
     conversation.
