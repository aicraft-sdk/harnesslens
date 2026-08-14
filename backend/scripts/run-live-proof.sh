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

# The api service has no docker-compose healthcheck (only db does), so `--wait` returns once the
# api container process is running, not once the NestJS app inside it has finished booting and is
# listening on :3000. Poll until the health endpoint actually responds instead of racing it.
echo "==> Waiting for health check to respond"
for _ in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null; then
    break
  fi
  sleep 1
done
curl -sf http://localhost:3000/health

echo
echo "==> Running full e2e proof-scenario suite (test/e2e)"
npm run test:integration -- test/e2e

echo "==> Live proof run complete"
