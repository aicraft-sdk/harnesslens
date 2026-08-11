import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { exitGateChecks } from './exit-gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../../test/fixtures');

function checkById(id: string) {
  const check = exitGateChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('ai-craft exit-gate checks', () => {
  describe('AIC-11 — mutation-testing gate configured', () => {
    it('passes when CI invokes stryker with a config file', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ready'));
      const outcome = checkById('AIC-11').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('stryker.conf');
    });

    it('fails when no mutation-testing gate is wired (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-11').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-12 — security scan (SAST/secrets/deps) wired in CI', () => {
    it('passes when CI invokes semgrep', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ready'));
      const outcome = checkById('AIC-12').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('semgrep');
    });

    it('fails when there is no CI configuration to inspect (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-12').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-13 — accessibility gate (axe-core) wired', () => {
    it('passes when package.json devDependencies include @axe-core/*', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ready'));
      const outcome = checkById('AIC-13').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('@axe-core/cli');
    });

    it('fails when no axe-core/pa11y is wired anywhere (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-13').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-14 — performance budget configured', () => {
    it('passes when a lighthouserc.* file is present', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ready'));
      const outcome = checkById('AIC-14').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('lighthouserc.json');
    });

    it('fails when no lighthouserc.* or documented perf budget exists (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-14').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-15 — cost/budget ceiling documented or enforced', () => {
    it('passes when a documented cost-cap mechanism is found (e.g. maxUsd in AGENTS.md)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ready'));
      const outcome = checkById('AIC-15').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('AGENTS.md');
    });

    it('fails when no cost-cap mechanism is documented or enforced anywhere (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-15').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-16 — lint complexity/maintainability rule configured', () => {
    it('passes when eslint config declares a complexity rule', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ready'));
      const outcome = checkById('AIC-16').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('eslint.config.js');
    });

    it('fails when no eslint complexity-style rule is configured (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-16').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-17 — AGENTS.md/CLAUDE.md rule-count-under-N convention', () => {
    it('passes when AGENTS.md exists with a rule count under the threshold', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ready'));
      const outcome = checkById('AIC-17').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('AGENTS.md');
    });

    it('fails when neither AGENTS.md nor CLAUDE.md exists (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-17').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('regression: false-positive/false-negative reproductions from silent-failure-hunter', () => {
    it('AIC-16 does not treat an unrelated "lint:complexity" npm script key as a configured complexity rule', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-lint-script-fp'));
      const outcome = checkById('AIC-16').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toContain('No ESLint complexity-style rule');
    });

    it('AIC-13 finds an axe-core devDependency declared in a non-root workspace package.json', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-nested-axe-dep'));
      const outcome = checkById('AIC-13').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('packages/widgets/package.json');
      expect(outcome.evidence).toContain('@axe-core/cli');
    });

    it('AIC-12 does not treat a "# TODO: wire up gitleaks" CI comment as an actual security-scan invocation', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'exit-gate-ci-todo-comment'));
      const outcome = checkById('AIC-12').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toContain('does not appear to invoke');
    });
  });
});
