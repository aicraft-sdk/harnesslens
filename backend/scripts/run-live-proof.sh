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

echo "==> Starting docker-compose stack (docker compose up -d --wait)"
docker compose up -d --wait

# `docker compose up -d --wait` already blocks on the api service's own healthcheck (GET /health),
# so the app has finished booting and is listening on :3000 by this point. This poll +
# diagnostics-on-failure check is a belt-and-suspenders confirmation, not a race workaround.
echo "==> Waiting for health check to respond"
for _ in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf http://localhost:3000/health; then
  echo "FATAL: /health did not respond successfully after startup wait" >&2
  echo "==> Dumping docker compose logs for diagnosis" >&2
  docker compose logs
  exit 1
fi

echo
echo "==> Running full e2e proof-scenario suite (test/e2e)"
npm run test:integration -- test/e2e

echo "==> Live proof run complete"
