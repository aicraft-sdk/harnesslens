# harnesslens-leaderboard

Static-site leaderboard generator consuming `harnesslens --json` submissions
(self-reported via CI). Internal tooling — `private: true`, not published to npm.

## What this is

`harnesslens-leaderboard` turns a directory of self-reported `harnesslens`
scan results into a static, client-side-rendered leaderboard table. It is a companion
package to [`harnesslens`](../README.md): that
package produces the JSON report for a single repo (`harnesslens --json`); this package
aggregates many repos' reports into one comparable table and publishes it as a static
site (via GitHub Pages — see `.github/workflows/rebuild-leaderboard.yml`).

Nothing here is independently verified. Every entry is a self-reported score submitted
by the scanned repo's own maintainers — see "Why PR-based, not direct-commit" below for
how that trust boundary is handled.

## Pipeline

```
submissions/<repoId>.json (self-reported, untrusted)
  │
  ▼
parseSubmission(raw, file)        src/parse-submission.ts
  → allowlist-validates exactly 7 named fields (repoId, score, level, dimensions,
    frameworkMapping, commitSha, scannedAt) and rebuilds a new object field-by-field —
    never spreads the raw parsed JSON. See the decision doc linked below.
  │
  ▼
buildLeaderboard(files)           src/build-leaderboard.ts
  → pure aggregation: dedupes by repoId (keeps the newest scannedAt), flags entries
    older than STALE_THRESHOLD_DAYS (90 days) as stale, and routes every rejected or
    superseded file into a `skipped` list with a reason instead of dropping it silently.
  │
  ▼
runCli(argv)                      src/cli.ts
  → impure shell: reads a submissions directory, calls the pure parse/aggregate
    functions above, and writes <outDir>/site-data.json. A malformed or unreadable
    submission is skipped (logged to stderr) — it never fails the whole rebuild.
  │
  ▼
renderLeaderboardTable(container, entries)   src/render.ts
  → builds the leaderboard <table> via document.createElement + .textContent only.
    Consumed by site/index.html at runtime (fetches ./site-data.json, then dynamic-
    imports the built render.js).
```

## Submission schema

A submission is one JSON file at `submissions/<repoId-with-slashes-replaced-by-dashes>.json`.
It must contain exactly these 7 fields (matching `ValidatedSubmission` in `src/types.ts`);
any other field is dropped by the allowlist parser and never reaches the leaderboard:

| Field | Type | Example |
|---|---|---|
| `repoId` | `string` | `"ai-craft/harness-audit"` |
| `score` | `number` | `82` |
| `level` | `{ index: number; name: string }` | `{ "index": 3, "name": "Structured" }` |
| `dimensions` | `Array<{ id: string; title: string; earned: number; max: number; percent: number }>` | `[{ "id": "context", "title": "Context Engineering", "earned": 8, "max": 10, "percent": 80 }]` |
| `frameworkMapping` | `Record<string, { nistFunctions: string[]; owaspIds: string[] }>` | `{ "context": { "nistFunctions": ["Govern"], "owaspIds": ["ASI01"] } }` |
| `commitSha` | `string` | `"a1b2c3d4e5f6..."` |
| `scannedAt` | `string` (ISO 8601) | `"2026-08-11T06:00:00.000Z"` |

## Why PR-based, not direct-commit

Submissions are attacker-controlled input by construction: any repo can claim any score.
Rather than accept a direct write (e.g. a webhook or API that writes straight into
`submissions/`), the intended flow is a pull request against this monorepo, so that:

- A human reviews the diff before a new/updated submission JSON is merged (the "Durable
  Decisions" trust boundary documented in
  [`docs/2026-08-11-harness-audit-leaderboard-submission-allowlist-decision.md`](https://github.com/aicraft-sdk/ai-craft/blob/main/docs/2026-08-11-harness-audit-leaderboard-submission-allowlist-decision.md)).
- The allowlist parser (`src/parse-submission.ts`) is a second, independent layer of
  defense even if a malformed or malicious submission slips past review — only the 7
  fields above are ever read, and the render layer is `.textContent`-only (never
  `innerHTML`), so even an accepted malicious payload cannot execute script in the
  rendered page.
- No repo needs write access to this monorepo's default branch or CI secrets to appear
  on the leaderboard — only the ability to open a PR.

## Submitting your repo's score

Add a workflow like this to **your own repo** (not this one) to open a PR against
`aicraft-sdk/harnesslens`'s `leaderboard/submissions/` directory whenever you push to
`main`:

```yaml
# .github/workflows/harnesslens-submit.yml (add to YOUR repo — not this one)
name: Submit harnesslens score to leaderboard
on:
  push:
    branches: [main]
jobs:
  submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx --yes harnesslens --json > /tmp/report.json
      - name: Build submission JSON
        run: |
          node -e '
            const r = JSON.parse(require("fs").readFileSync("/tmp/report.json", "utf8"));
            const submission = {
              repoId: process.env.GITHUB_REPOSITORY,
              score: r.score.percent,
              level: r.level,
              dimensions: r.dimensions,
              frameworkMapping: r.frameworkMapping,
              commitSha: process.env.GITHUB_SHA,
              scannedAt: new Date().toISOString(),
            };
            require("fs").writeFileSync("/tmp/submission.json", JSON.stringify(submission, null, 2));
          '
      - name: Open PR against the leaderboard repo
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.LEADERBOARD_SUBMIT_TOKEN }} # repo-scoped PAT/App token — you provision this
          path: /tmp/submission.json
          # ... push /tmp/submission.json to aicraft-sdk/harnesslens's leaderboard/submissions/<repoId>.json
```

`LEADERBOARD_SUBMIT_TOKEN` provisioning (a fine-grained PAT or GitHub App scoped to this
monorepo, with pull-request-create permission) is a manual, one-time setup step performed
by the submitting repo's own maintainer. This README documents the requirement; it does
not create, hold, or distribute that credential.

## Usage (local)

```bash
nvm use 22.14.0
npm run build
node dist/cli.js <submissionsDir> <outDir>
```

- `<submissionsDir>` defaults to `submissions` (relative to cwd) if omitted.
- `<outDir>` defaults to `publish` (relative to cwd) if omitted.
- Writes `<outDir>/site-data.json`: `{ generatedAt: string, entries: LeaderboardEntry[] }`.

To view the result locally, copy `site/index.html`, `site/style.css`, and the built
`render.js` alongside the generated `site-data.json`, then serve that directory
(e.g. `python3 -m http.server`) and open it in a browser — `index.html` fetches
`./site-data.json` and renders the table client-side.

## Security model

Submissions are PR-authored by external repo owners, so `submissions/<repoId>.json` is
attacker-controlled input by design. Two independent layers keep that input inert:

- **Input: allowlist parsing** (`src/parse-submission.ts`) — only 7 named fields are ever
  read; the output object is always constructed fresh, never `{...raw}`. `__proto__` /
  `constructor` / `prototype` keys are rejected wherever a submission-controlled string is
  later used as an object key (`frameworkMapping`, `dimensions[].id`). See
  [`docs/2026-08-11-harness-audit-leaderboard-submission-allowlist-decision.md`](https://github.com/aicraft-sdk/ai-craft/blob/main/docs/2026-08-11-harness-audit-leaderboard-submission-allowlist-decision.md).
- **Output: `.textContent`-only rendering** (`src/render.ts`) — every submission-derived
  table cell (repo id, dimension titles, framework-mapping text) is written via
  `.textContent`, never `.innerHTML`, so an HTML/script payload in a submission field
  (e.g. a `dimensions[].title` of `<img src=x onerror=alert(1)>`) renders as inert visible
  text instead of executing.

## Publishing

`.github/workflows/rebuild-leaderboard.yml` rebuilds and publishes the static site to
GitHub Pages: on a daily schedule, on push to `main` when `submissions/**` changes, and
on manual dispatch. See `submissions/README.md` for the submissions directory contract.
