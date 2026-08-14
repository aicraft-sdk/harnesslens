import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScanContext } from '../../scan.js';
import { contextChecks } from './context.js';

function checkById(id: string) {
  const check = contextChecks.find((c) => c.id === id);
  if (!check) throw new Error(`fixture assumption broken: check ${id} not found`);
  return check;
}

describe('core context checks', () => {
  describe('CTX-09 — secure-coding guidance instructed to the agent', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harnesslens-ctx09-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('fails when there is no agent context file or rules at all', () => {
      fs.writeFileSync(path.join(dir, 'src.js'), 'console.log(1);\n');
      const ctx = createScanContext(dir);
      const outcome = checkById('CTX-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/No agent context file or scoped rules/);
    });

    it('fails when AGENTS.md exists but has no secure-coding guidance', () => {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Guide\n\nBuild with `npm run build`.\n');
      const ctx = createScanContext(dir);
      const outcome = checkById('CTX-09').run(ctx);
      expect(outcome.passed).toBe(false);
      expect(outcome.evidence).toMatch(/no explicit secure-coding guidance found/);
    });

    it('passes when AGENTS.md tells the agent not to hardcode credentials', () => {
      fs.writeFileSync(
        path.join(dir, 'AGENTS.md'),
        '# Guide\n\nNever hardcode secrets or credentials in source files.\n',
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('CTX-09').run(ctx);
      expect(outcome.passed).toBe(true);
      expect(outcome.evidence).toMatch(/AGENTS\.md/);
    });

    it('passes when a scoped rule mentions parameterized queries / SQL injection', () => {
      fs.mkdirSync(path.join(dir, '.cursor', 'rules'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.cursor', 'rules', 'security.mdc'),
        '---\ndescription: security\nalwaysApply: true\n---\n\nAlways use parameterized queries to avoid SQL injection.\n',
      );
      const ctx = createScanContext(dir);
      const outcome = checkById('CTX-09').run(ctx);
      expect(outcome.passed).toBe(true);
    });
  });
});
