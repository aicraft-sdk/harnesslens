/**
 * Agent-output exit-gate readiness checks: static, CI/config-presence checks
 * for Addy Osmani's 7 "exit gate" quality dimensions (correctness/mutation-
 * testing, security, accessibility, performance, cost, maintainability,
 * comprehensibility) — see the Decision RFC at
 * `docs/plans/2026-08-11-agent-exit-gate-quality-dimensions-rfc.md`.
 *
 * Like `packs/core/ci.ts`'s `CI-02`/`CI-03`, every check here can only prove
 * a tool is *wired* (config/CI content mentions it), never that a run of it
 * *passed* — `ScanContext.run(ctx)` is synchronous and fs-only (see
 * `types.ts`/`scan.ts`), so no check can shell out to Stryker/PIT, a SAST
 * scanner, or axe-core itself. Evidence text always names exactly what
 * matched, since false negatives ("looks wired but isn't") are the RFC's own
 * flagged dangerous failure class for this pack.
 */

import { defineCheck } from '../../define.js';
import type { Check, ScanContext } from '../../types.js';
import { safeJsonParse } from '../../util.js';

const WORKFLOW_RE = /(^|\/)\.github\/workflows\/[^/]+\.(yml|yaml)$/;
const OTHER_CI = [
  '.gitlab-ci.yml',
  'azure-pipelines.yml',
  '.circleci/config.yml',
  'Jenkinsfile',
  'bitbucket-pipelines.yml',
];

/** Same detection pattern as `packs/core/ci.ts`'s `ciFiles` — not imported since that helper is unexported. */
function ciFiles(ctx: ScanContext): string[] {
  return [...ctx.matching(WORKFLOW_RE), ...OTHER_CI.filter((f) => ctx.has(f))];
}

/** Lines that are only a `#`/`//` comment carry no proof a tool actually runs — strip them before matching. */
const COMMENT_LINE_RE = /^\s*(#|\/\/)/;
function stripCommentLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !COMMENT_LINE_RE.test(line))
    .join('\n');
}

/**
 * Local copy of `packs/core/ci.ts`'s `ciContent` (unexported upstream, so
 * reimplemented here) — deliberately diverges from that copy by stripping
 * `#`/`//`-prefixed comment lines first, so a CI file that only *mentions* a
 * tool in a TODO/comment (never actually invoking it) cannot register as
 * "wired." `packs/core/ci.ts` itself is out of scope for this fix.
 */
function ciContent(ctx: ScanContext): string {
  return ciFiles(ctx)
    .map((f) => stripCommentLines(ctx.read(f) ?? ''))
    .join('\n');
}

const PACKAGE_JSON_RE = /(^|\/)package\.json$/;

/**
 * Every `package.json` in the scanned tree, parsed — not just the repo root.
 * In an NX/pnpm-workspace monorepo, tooling deps are far more often declared
 * in a `packages/<pkg>/package.json` than the root one (see AIC-13 below).
 */
function workspacePackageJsons(ctx: ScanContext): Array<{ file: string; pkg: Record<string, any> }> {
  const result: Array<{ file: string; pkg: Record<string, any> }> = [];
  for (const file of ctx.matching(PACKAGE_JSON_RE)) {
    const content = ctx.read(file);
    const parsed = content ? safeJsonParse(content) : null;
    if (parsed && typeof parsed === 'object') {
      result.push({ file, pkg: parsed as Record<string, any> });
    }
  }
  return result;
}

const MUTATION_CONFIG_FILE_RE = /(^|\/)stryker\.conf(ig)?\.(js|json|mjs|cjs)$/i;
const MUTATION_CI_RE = /stryker\.conf|mutationScore|mutationThreshold|thresholds\.break|\bpitest\b|\bmutmut\b/i;

const SECURITY_SCAN_RE = /\bgitleaks\b|\bsemgrep\b|\btrivy\b|\bcodeql\b/i;

const AXE_DEP_RE = /^@axe-core\/|^axe-core$|^pa11y$/i;
const AXE_CI_RE = /\baxe-core\b|\bpa11y\b/i;

const LIGHTHOUSERC_RE = /(^|\/)\.?lighthouserc(\.js|\.json|\.yml|\.yaml)?$/i;
const PERF_BUDGET_DOC_RE = /\bperformance budget\b/i;
const DOC_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md'];

/** Candidate files a documented/enforced cost cap could live in — kept narrow and named, not a full-repo scan. */
const COST_CAP_FILE_RE = /(^|\/)([^/]*(budget|cost)[^/]*)\.(ts|js|md|json)$/i;
const COST_CAP_CONTENT_RE =
  /\bmaxUsd\b|\bMAX_USD\b|--max-usd\b|\bcost\s*cap\b|\bbudget\s*ceiling\b|\bspending\s*limit\b|\busd\s*cap\b/i;

const ESLINT_CONFIG_RE = /(^|\/)eslint\.config\.(js|mjs|cjs|ts)$/i;
const ESLINTRC_RE = /(^|\/)\.eslintrc(\.json|\.js|\.cjs|\.yml|\.yaml)?$/i;
/**
 * `(?<![\w:-])` blocks matching "complexity" as the tail of an unrelated key
 * like `"lint:complexity"` (an npm script name, not a rule config) while
 * still matching a genuine rule key on the same line as other JSON content
 * (e.g. `"rules": { "complexity": ... }`), which a pure line-start anchor
 * would have missed.
 */
const COMPLEXITY_RULE_RE =
  /(?<![\w:-])['"]?(?:complexity|max-lines-per-function|max-lines)['"]?\s*:|sonarjs\/cognitive-complexity/i;

const AGENT_RULE_DOC_FILES = ['AGENTS.md', 'CLAUDE.md'];
const RULE_LIST_ITEM_RE = /^\s*(?:[-*]|\d+[.)])\s+\S/gm;
const RULE_COUNT_THRESHOLD = 50;

export const exitGateChecks: Check[] = [
  defineCheck({
    id: 'AIC-11',
    dimension: 'exit-gate',
    title: 'Mutation-testing gate configured',
    points: 3,
    remediation:
      'Wire a mutation-testing gate (Stryker, PIT, mutmut…) with a break threshold (e.g. thresholds.break / mutationThreshold) so agent-authored tests are proven to actually kill mutants, not just execute.',
    run(ctx) {
      const configFiles = ctx.matching(MUTATION_CONFIG_FILE_RE);
      if (configFiles.length > 0) {
        return { passed: true, evidence: `Found mutation-testing config: ${configFiles[0]}.` };
      }
      const match = ciContent(ctx).match(MUTATION_CI_RE);
      return match
        ? { passed: true, evidence: `CI references a mutation-testing gate ("${match[0]}").` }
        : {
            passed: false,
            evidence:
              'No stryker.conf.* file and no mutation-testing gate reference (stryker.conf/thresholds.break/mutationThreshold/PIT) found in CI config.',
          };
    },
  }),
  defineCheck({
    id: 'AIC-12',
    dimension: 'exit-gate',
    title: 'Security scan (SAST/secrets/deps) wired in CI',
    points: 3,
    remediation:
      'Wire a SAST/secrets/dependency scanner into CI (gitleaks, semgrep, trivy, or CodeQL) so agent-authored code is scanned on every push, not only at human review time.',
    run(ctx) {
      if (ciFiles(ctx).length === 0) {
        return { passed: false, evidence: 'No CI configuration to inspect.' };
      }
      const match = ciContent(ctx).match(SECURITY_SCAN_RE);
      return match
        ? { passed: true, evidence: `CI invokes a security scanner ("${match[0]}").` }
        : {
            passed: false,
            evidence: 'CI configuration does not appear to invoke gitleaks, semgrep, trivy, or codeql.',
          };
    },
  }),
  defineCheck({
    id: 'AIC-13',
    dimension: 'exit-gate',
    title: 'Accessibility gate (axe-core) wired',
    points: 2,
    remediation:
      'Add an accessibility scanner (@axe-core/* or pa11y) as a devDependency, or invoke it in CI, so agent-authored UI changes are checked for a11y regressions.',
    run(ctx) {
      for (const { file, pkg } of workspacePackageJsons(ctx)) {
        const depNames = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
        const dep = depNames.find((name) => AXE_DEP_RE.test(name));
        if (dep) {
          return { passed: true, evidence: `${file} devDependencies includes "${dep}".` };
        }
      }
      const match = ciContent(ctx).match(AXE_CI_RE);
      return match
        ? { passed: true, evidence: `CI references an accessibility scanner ("${match[0]}").` }
        : {
            passed: false,
            evidence: 'No @axe-core/* or pa11y devDependency, and no axe-core/pa11y reference in CI config.',
          };
    },
  }),
  defineCheck({
    id: 'AIC-14',
    dimension: 'exit-gate',
    title: 'Performance budget configured',
    points: 2,
    remediation:
      'Add a Lighthouse CI config (lighthouserc.json/.js/.yml) or document a performance budget so agent-authored changes cannot silently regress load performance.',
    run(ctx) {
      const files = ctx.matching(LIGHTHOUSERC_RE);
      if (files.length > 0) {
        return { passed: true, evidence: `Found performance budget config: ${files[0]}.` };
      }
      for (const file of DOC_FILES) {
        if (!ctx.has(file)) continue;
        const content = ctx.read(file) ?? '';
        if (PERF_BUDGET_DOC_RE.test(content)) {
          return { passed: true, evidence: `${file} documents a "performance budget".` };
        }
      }
      return {
        passed: false,
        evidence: 'No lighthouserc.* file and no documented "performance budget" found in README/AGENTS.md/CLAUDE.md.',
      };
    },
  }),
  defineCheck({
    id: 'AIC-15',
    dimension: 'exit-gate',
    title: 'Cost/budget ceiling documented or enforced',
    points: 2,
    remediation:
      'Document or enforce a per-run cost ceiling (e.g. a maxUsd-style budget gate, or a stated cost cap in your agent docs) — this repo\'s own packages/agent-loop BudgetGate is a live example of the pattern.',
    run(ctx) {
      const candidateFiles = [
        ...DOC_FILES.filter((f) => ctx.has(f)),
        ...ctx.matching(COST_CAP_FILE_RE),
      ];
      const seen = new Set<string>();
      for (const file of candidateFiles) {
        if (seen.has(file)) continue;
        seen.add(file);
        const content = ctx.read(file) ?? '';
        const match = content.match(COST_CAP_CONTENT_RE);
        if (match) {
          return { passed: true, evidence: `${file} references a cost-cap mechanism ("${match[0]}").` };
        }
      }
      return {
        passed: false,
        evidence:
          'No documented or enforced cost/budget ceiling found (checked README/AGENTS.md/CLAUDE.md and *budget*/*cost*-named source/doc files for maxUsd/cost cap/budget ceiling/spending limit).',
      };
    },
  }),
  defineCheck({
    id: 'AIC-16',
    dimension: 'exit-gate',
    title: 'Lint complexity/maintainability rule configured',
    points: 2,
    remediation:
      'Add a complexity-style lint rule (complexity, max-lines-per-function, max-lines, or sonarjs/cognitive-complexity) so agent-authored functions cannot silently balloon past a maintainable size.',
    run(ctx) {
      const candidateFiles = [
        ...ctx.matching(ESLINT_CONFIG_RE),
        ...ctx.matching(ESLINTRC_RE),
        ...(ctx.has('package.json') ? ['package.json'] : []),
      ];
      for (const file of candidateFiles) {
        const content = ctx.read(file) ?? '';
        const match = content.match(COMPLEXITY_RULE_RE);
        if (match) {
          return { passed: true, evidence: `${file} configures a complexity-style rule ("${match[0].trim()}").` };
        }
      }
      return {
        passed: false,
        evidence:
          'No ESLint complexity-style rule (complexity/max-lines/max-lines-per-function/sonarjs cognitive-complexity) found in eslint config or package.json.',
      };
    },
  }),
  defineCheck({
    id: 'AIC-17',
    dimension: 'exit-gate',
    title: 'AGENTS.md/CLAUDE.md rule-count-under-N convention',
    points: 1,
    remediation: `Keep AGENTS.md/CLAUDE.md under ${RULE_COUNT_THRESHOLD} rule items (bullet/numbered lines) — a harness file that grows past a maintainable rule budget stops being comprehensible to both agents and reviewers.`,
    run(ctx) {
      const file = AGENT_RULE_DOC_FILES.find((f) => ctx.has(f));
      if (!file) {
        return { passed: false, evidence: 'No AGENTS.md or CLAUDE.md found (no rule-count convention to check).' };
      }
      const content = ctx.read(file) ?? '';
      const count = content.match(RULE_LIST_ITEM_RE)?.length ?? 0;
      if (count === 0) {
        return { passed: false, evidence: `${file} found but contains no bullet/numbered rule items to count.` };
      }
      return count <= RULE_COUNT_THRESHOLD
        ? { passed: true, evidence: `${file}: ${count} rule item(s) (within the ${RULE_COUNT_THRESHOLD}-rule convention).` }
        : {
            passed: false,
            evidence: `${file}: ${count} rule item(s) exceeds the ${RULE_COUNT_THRESHOLD}-rule comprehensibility convention.`,
          };
    },
  }),
];
