import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN = /\bcertified\b|\biso[- ]?compliant\b/i;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('no "certified"/"ISO-compliant" language anywhere in shipped output or docs', () => {
  it('renderer + crosswalk source files are clean', () => {
    for (const file of walkTs(path.join(ROOT, 'src'))) {
      const text = fs.readFileSync(file, 'utf8');
      expect(FORBIDDEN.test(text), `${file} contains forbidden certification language`).toBe(false);
    }
  });

  it('README.md and ARCHITECTURE.md are clean', () => {
    for (const name of ['README.md', 'ARCHITECTURE.md']) {
      const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
      expect(FORBIDDEN.test(text), `${name} contains forbidden certification language`).toBe(false);
    }
  });
});
