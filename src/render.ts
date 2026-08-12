/**
 * SECURITY: builds every submission-derived cell via `.textContent` only.
 * Never uses `.innerHTML` with any interpolated submission data.
 */
import type { LeaderboardEntry } from './types.js';

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text; // never innerHTML — this is the whole security boundary.
  if (className) td.className = className;
  return td;
}

function mappingSummary(entry: LeaderboardEntry): string {
  // Iterates entry.dimensions (not just frameworkMapping) so each dimension's title is
  // surfaced in the table, matching P4's requirement that a submission-derived title string
  // (e.g. an XSS payload) shows up somewhere as visible text — still .textContent-only.
  const parts = entry.dimensions.map((dimension) => {
    const mapping = entry.frameworkMapping[dimension.id];
    const frameworkText = mapping
      ? `${mapping.nistFunctions.join('/')}${mapping.owaspIds.length ? ` (${mapping.owaspIds.join(',')})` : ''}`
      : '';
    return `${dimension.title}: ${frameworkText}`;
  });
  return parts.join('; ');
}

export function renderLeaderboardTable(container: HTMLElement, entries: LeaderboardEntry[]): void {
  container.textContent = '';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const heading of ['Repo', 'Score', 'Level', 'Framework mapping', 'Scanned', 'Status']) {
    const th = document.createElement('th');
    th.textContent = heading; // static, not attacker-controlled — safe either way.
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const entry of entries) {
    const row = document.createElement('tr');
    if (entry.stale) row.classList.add('stale');
    row.appendChild(cell(entry.repoId));
    row.appendChild(cell(`${entry.score}%`));
    row.appendChild(cell(`L${entry.level.index} · ${entry.level.name}`));
    row.appendChild(cell(mappingSummary(entry)));
    row.appendChild(cell(entry.scannedAt));
    row.appendChild(cell(entry.stale ? 'stale' : 'current'));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}
