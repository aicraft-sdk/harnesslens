import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { hygieneChecks } from './hygiene.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../../test/fixtures');

function checkById(id: string) {
  const check = hygieneChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('ai-craft hygiene checks', () => {
  describe('AIC-09 — root LICENSE present', () => {
    it('passes when a LICENSE file exists at the repository root', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-09').run(ctx);
      expect(outcome.passed).toBe(true);
    });

    it('fails when no LICENSE file exists (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-09').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-10 — .env.example present when .gitignore covers .env', () => {
    it('passes when .gitignore covers .env AND a .env.example template exists', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-10').run(ctx);
      expect(outcome.passed).toBe(true);
    });

    it('fails when .gitignore covers .env but no .env.example template exists (level-4)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-4'));
      const outcome = checkById('AIC-10').run(ctx);
      expect(outcome.passed).toBe(false);
    });

    it('passes trivially when .gitignore does not reference .env at all (level-0, nothing to template)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-10').run(ctx);
      expect(outcome.passed).toBe(true);
    });
  });
});
