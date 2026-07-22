import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { monorepoChecks } from './monorepo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../../test/fixtures');

function checkById(id: string) {
  const check = monorepoChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('ai-craft monorepo checks', () => {
  describe('AIC-04 — NX monorepo structure', () => {
    it('passes when nx.json + a package project.json are present', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-04').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('nx.json');
    });

    it('fails when neither nx.json nor a project.json exists (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-04').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-05 — changesets release convention', () => {
    it('passes when .changeset/config.json is present', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-05').run(ctx);
      expect(outcome.passed).toBe(true);
    });

    it('fails when no .changeset directory exists (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-05').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });
});
