# AI-First Charter

Non-negotiable principles for AI-assisted work in this fixture repository.
This charter exists to prove the governance check can detect a genuinely
substantive charter file, not just its bare presence.

## Spec before code

No implementation without a linked feature spec under `docs/ai/specs/`.
Specs carry FR-### functional requirements and SC-### success criteria.

## Plan before build

Follow the plan phases and gates before writing any code. A plan should be
reviewed before implementation starts, and phases should be executed in
order without skipping ahead.

## TDD

RED, then GREEN, then REFACTOR — every behavior change gets a failing test
before any production code is written. Tests prove intent, not just output.

## Evidence before claim

Paste verifier / test command output; do not assert "passing" without proof.
Exit codes and command transcripts are the only acceptable evidence.

## Secrets discipline

Never commit secrets, tokens, or private keys; use environment variables
and a `.env.example` template so contributors know what to configure.

## Publishing contract

All packages are published with changesets; no manual `npm publish` calls
are permitted outside the changesets release flow.
