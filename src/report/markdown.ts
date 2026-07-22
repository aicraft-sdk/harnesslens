/**
 * Ported from harness-score's `report/markdown.ts`
 * (https://github.com/paladini/harness-score, MIT — see NOTICE).
 * Difference from upstream: the baseline-diff rendering (`ReportDiff` /
 * `diff.ts`) is a CLI-only concern not in scope for this phase's programmatic
 * core engine, so the optional `diff` parameter and `renderDiffSection` are
 * dropped here — the report-rendering contract for a `Report` is unchanged.
 */

import { toolDisplayName } from '../harness/registry.js';
import type { Report } from '../types.js';

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(`# Harness Audit Report`);
  lines.push('');
  lines.push(`**Maturity level:** L${report.level.index} · ${report.level.name}`);
  lines.push(`**Maturity score:** ${report.score.earned}/${report.score.max} (${report.score.percent}%)`);
  lines.push(`**Maturity scopes:** ${report.scopes.maturity.join(', ')}`);
  if (
    report.effective.level.index !== report.level.index ||
    report.effective.score.percent !== report.score.percent
  ) {
    lines.push(`**Effective level:** L${report.effective.level.index} · ${report.effective.level.name}`);
    lines.push(
      `**Effective score:** ${report.effective.score.earned}/${report.effective.score.max} (${report.effective.score.percent}%)`,
    );
    lines.push(`**Effective scopes:** ${report.scopes.effective.join(', ')}`);
  }
  lines.push(`**Gate:** ${report.gate}`);
  const detected = report.detectedHarnesses ?? [];
  if (detected.length > 0) {
    lines.push(`**Detected harnesses:** ${detected.map(toolDisplayName).join(', ')}`);
  }
  lines.push('');
  lines.push('## Dimensions');
  lines.push('');
  lines.push('| Dimension | Score | % |');
  lines.push('|---|---|---|');
  for (const dimension of report.dimensions) {
    lines.push(`| ${dimension.title} | ${dimension.earned}/${dimension.max} | ${dimension.percent}% |`);
  }
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| | Check | Points | Evidence |');
  lines.push('|---|---|---|---|');
  for (const check of report.checks) {
    const status = check.passed ? '✅' : '❌';
    lines.push(
      `| ${status} | [${check.id}](${check.docsUrl}) ${check.title} | ${check.earned}/${check.points} | ${check.evidence.replace(/\|/g, '\\|')} |`,
    );
  }
  const failed = report.checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    lines.push('');
    lines.push('## Recommended improvements');
    lines.push('');
    for (const check of failed) {
      lines.push(`- **${check.id}** — ${check.remediation} ([guide](${check.docsUrl}))`);
    }
  }
  if (report.level.nextLevelGaps.length > 0) {
    lines.push('');
    lines.push(`**To reach L${report.level.index + 1}:** ${report.level.nextLevelGaps.join('; ')}`);
  }
  lines.push('');
  return lines.join('\n');
}
