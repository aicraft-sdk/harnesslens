#!/usr/bin/env bash
# Full-stack live proof-scenario runner (Phase 5, Task 5.2).
#
# Brings up the docker-compose-managed stack (fresh Postgres volume + freshly built dev-stage
# image, per docker-compose.yml's api/migrate services pinned to build.target: dev), waits for it
# to become healthy, then runs the full e2e proof-scenario suite from Phases 0-4, then tears the
# stack down. Always tears down (via trap), even if the test run fails, so a failed run never
# leaves an orphaned Postgres volume or containers behind.
set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() {
  echo "==> Tearing down docker-compose stack"
  docker compose down -v
}
trap cleanup EXIT

fatal_dump_logs() {
  echo "FATAL: $1" >&2
  echo "==> Dumping docker compose logs for diagnosis" >&2
  docker compose logs
  exit 1
}

echo "==> Starting docker-compose stack (docker compose up -d --wait)"
# `up --wait` itself exits non-zero under `set -e` when any service -- the api container's own
# healthcheck, or an upstream dependency like migrate -- fails to become healthy/complete
# successfully. Guard it explicitly so that failure path always reaches the log dump instead of
# aborting the whole script silently before diagnostics can run.
if ! docker compose up -d --wait; then
  fatal_dump_logs "docker compose up -d --wait failed (a service did not start or become healthy)"
fi

# `--wait` already blocked on the api container's own healthcheck (which probes /health/db), so
# this is a single confirming call, not a retry/poll loop.
echo "==> Confirming /health/db responds now that the stack reports healthy"
if ! curl -sf http://localhost:3000/health/db > /dev/null; then
  fatal_dump_logs "/health/db did not respond successfully even though docker compose reported healthy"
fi

echo
echo "==> Running full e2e proof-scenario suite (test/e2e)"
npm run test:integration -- test/e2e

echo "==> Live proof run complete"
