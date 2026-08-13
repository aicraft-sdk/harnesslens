#!/usr/bin/env node
// backend/scripts/stress-scenario.mjs
// Minimal scaffold for the Live Verification Strategy's stress scenario. Implements only
// "submission-burst" today. This is a scaffold proving the npm script is real and runnable, not a
// tuned load-test harness -- exact concurrency profile and pass/fail thresholds beyond "every
// request in the burst succeeds and no data is corrupted" are deferred (see Risks table).
const args = process.argv.slice(2);
const scenarioFlagIndex = args.indexOf('--scenario');
const scenario = scenarioFlagIndex >= 0 ? args[scenarioFlagIndex + 1] : undefined;

const BASE_URL = process.env.STRESS_BASE_URL ?? 'http://localhost:3000';

async function submissionBurst() {
  const limit = Number(process.env.SUBMIT_RATE_LIMIT_PER_MIN ?? 30);
  const concurrency = limit; // stays within the configured rate-limit threshold, per the scenario's own name
  const payload = {
    repoId: 'stress/scenario-repo',
    score: 50,
    level: { index: 1, name: 'L1' },
    dimensions: [],
    frameworkMapping: {},
    commitSha: '0'.repeat(40),
    scannedAt: new Date().toISOString(),
  };
  const statuses = await Promise.all(
    Array.from({ length: concurrency }, () =>
      fetch(`${BASE_URL}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.status),
    ),
  );
  const failures = statuses.filter((status) => status !== 201);
  if (failures.length > 0) {
    console.error(`submission-burst: ${failures.length}/${concurrency} requests did not return 201`, failures);
    process.exitCode = 1;
    return;
  }
  console.log(`submission-burst: ${concurrency}/${concurrency} concurrent submissions to the same repoId succeeded without error`);
}

const scenarios = { 'submission-burst': submissionBurst };

if (!scenario || !scenarios[scenario]) {
  console.error(`Usage: node scripts/stress-scenario.mjs --scenario <${Object.keys(scenarios).join('|')}>`);
  process.exit(1);
}

await scenarios[scenario]();
