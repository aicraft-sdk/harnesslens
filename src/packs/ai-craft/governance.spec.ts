import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { governanceChecks } from './governance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../../test/fixtures');

function checkById(id: string) {
  const check = governanceChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('ai-craft governance checks', () => {
  describe('AIC-06 — AI-First governance charter + docs/ai/specs present', () => {
    it('passes when AI_FIRST.md is substantive and docs/ai/specs/ exists', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-06').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('AI_FIRST.md');
    });

    it('fails when no charter file or docs/ai/specs/ exists (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-06').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-07 — spec traceability (FR-/SC- identifiers)', () => {
    it('passes when a spec file under docs/ai/specs/ contains FR-### and SC-### markers', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-07').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('0001-example.md');
    });

    it('fails when there is no docs/ai/specs/ directory at all (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-07').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-08 — unresolved [NEEDS CLARIFICATION] markers (flag, not fail)', () => {
    it('reports the marker count but still passes (informational) when found', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-08').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('[NEEDS CLARIFICATION]');
      expect(outcome.evidence).toContain('1');
    });

    it('passes cleanly with zero markers when no specs exist (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-08').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('0');
    });
  });
});
