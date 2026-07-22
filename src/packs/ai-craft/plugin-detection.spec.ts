import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { pluginDetectionChecks } from './plugin-detection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../../test/fixtures');

function checkById(id: string) {
  const check = pluginDetectionChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('ai-craft plugin-detection checks', () => {
  describe('AIC-01 — plugin-delivered skills detected', () => {
    it('passes against the ai-craft-plugin fixture (structural tools/*/plugins/*/skills/*/SKILL.md)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-01').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('SKILL.md');
    });

    it('scores zero against a fixture with no plugin-delivered harness (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-01').run(ctx);
      expect(outcome.passed).toBe(false);
    });

    it('does not match a repo-root-style skill (not a false positive on the wrong shape)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-2'));
      const outcome = checkById('AIC-01').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-02 — plugin-delivered agents detected', () => {
    it('passes against the ai-craft-plugin fixture (structural tools/*/plugins/*/agents/*.md)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-02').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('example-agent.md');
    });

    it('scores zero against a fixture with no plugin-delivered harness (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-02').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });

  describe('AIC-03 — plugin-delivered hooks config detected', () => {
    it('passes against the ai-craft-plugin fixture (structural tools/*/plugins/*/hooks.json)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'ai-craft-plugin'));
      const outcome = checkById('AIC-03').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toContain('hooks.json');
    });

    it('scores zero against a fixture with no plugin-delivered harness (level-0)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-0'));
      const outcome = checkById('AIC-03').run(ctx);
      expect(outcome.passed).toBe(false);
    });

    it('does not credit a repo-root .cursor/hooks.json (not a plugin-path shape, level-4)', () => {
      const ctx = createScanContext(path.join(FIXTURES_ROOT, 'level-4'));
      const outcome = checkById('AIC-03').run(ctx);
      expect(outcome.passed).toBe(false);
    });
  });
});
