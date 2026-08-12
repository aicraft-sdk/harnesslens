// @vitest-environment happy-dom
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderLeaderboardTable } from './render.js';
import type { LeaderboardEntry } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XSS_FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../test/fixtures/xss-payload.json'), 'utf8'),
);

describe('renderLeaderboardTable — inertness (P4)', () => {
  it('renders an HTML/script payload in a dimension title as inert text, never as markup', () => {
    const entry: LeaderboardEntry = { ...XSS_FIXTURE, stale: false };
    const container = document.createElement('div');
    renderLeaderboardTable(container, [entry]);

    expect(container.querySelectorAll('script, img[onerror], svg[onload]')).toHaveLength(0);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders a normal entry with the expected columns', () => {
    const entry: LeaderboardEntry = {
      repoId: 'acme/widgets',
      score: 78,
      level: { index: 3, name: 'Sensing' },
      dimensions: [{ id: 'context', title: 'Context & Guides', earned: 4, max: 5, percent: 80 }],
      frameworkMapping: { context: { nistFunctions: ['Govern'], owaspIds: [] } },
      commitSha: 'abc1234',
      scannedAt: new Date().toISOString(),
      stale: false,
    };
    const container = document.createElement('div');
    renderLeaderboardTable(container, [entry]);
    expect(container.textContent).toContain('acme/widgets');
    expect(container.textContent).toContain('Sensing');
  });
});
