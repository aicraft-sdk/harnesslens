import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { hookChecks } from './hooks.js';

function checkById(id: string) {
  const check = hookChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('core hook checks', () => {
  describe('HKS-06 — explicit tool-permission scope declared', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-hks06-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('fails when no Claude Code settings file exists at all', () => {
      fs.writeFileSync(path.join(dir, 'README.md'), '# nothing here\n');
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/No \.claude\/settings\.json/);
    });

    it('fails when permissions block is present but empty', () => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: {} }));
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/empty or absent/);
    });

    it('fails with a distinct "not valid JSON" message when settings.json is malformed', () => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ "permissions": ');
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/not valid JSON/);
    });

    it('passes when a non-empty allow list is declared', () => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Bash(git status)'], deny: [], ask: [] } }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/non-empty permissions/);
    });

    it('passes when settings.json is malformed but settings.local.json has a valid non-empty scope', () => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ "permissions": ');
      fs.writeFileSync(
        path.join(dir, '.claude', 'settings.local.json'),
        JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(true);
    });

    it('mentions both failures when settings.json is malformed and settings.local.json is malformed too', () => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ "permissions": ');
      fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{ "permissions": {');
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/not valid JSON/);
    });

    it('mentions both the invalid-JSON file and the other file\'s empty permissions when one settings file is malformed and the other parses but has empty permissions', () => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ "permissions": ');
      fs.writeFileSync(
        path.join(dir, '.claude', 'settings.local.json'),
        JSON.stringify({ permissions: {} }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/not valid JSON/);
      expect(outcome.evidence).toMatch(/no other settings file declares a non-empty permissions scope/);
    });

    it('passes when a non-empty deny list is declared in settings.local.json', () => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.claude', 'settings.local.json'),
        JSON.stringify({ permissions: { deny: ['Bash(rm -rf *)'] } }),
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('HKS-06').run(ctx);
      expect(outcome.passed).toBe(true);
    });
  });
});
