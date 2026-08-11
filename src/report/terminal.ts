/**
 * Terminal report renderer (`report/terminal.ts`). See NOTICE for
 * third-party attribution.
 * Note: the baseline-diff rendering (`ReportDiff` /
 * `diff.ts`) is a CLI-only concern not in scope for this phase's programmatic
 * core engine, so the optional `diff` parameter and `renderDiffSection` are
 * dropped here — the report-rendering contract for a `Report` is unchanged.
 */

import { toolDisplayName } from '../harness/registry.js';
import type { Report } from '../types.js';

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const paint = (code: string) => (text: string) => (useColor ? `[${code}m${text}[0m` : text);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');

const MIDDOT = '·';
const BLOCK = '█';
const BLOCK_LIGHT = '░';
const WARN = '⚠';
const CROSS = '✗';

const LEVEL_COLOR = [red, yellow, yellow, green, green];

function bar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  return BLOCK.repeat(filled) + BLOCK_LIGHT.repeat(width - filled);
}

function effectiveDiffers(report: Report): boolean {
  return (
    report.effective.level.index !== report.level.index ||
    report.effective.score.percent !== report.score.percent
  );
}

function formatScopes(scopes: string[]): string {
  return scopes.join(', ');
}

export function renderTerminal(report: Report): string {
  const lines: string[] = [];
  const levelPaint = LEVEL_COLOR[report.level.index] ?? red;
  lines.push('');
  lines.push(bold(`  harness-audit v${report.tool.version}`) + dim(`  ${report.root}`));
  lines.push('');
  if (report.truncated) {
    lines.push(
      yellow(
        `  ${WARN} Scan stopped early after hitting the file-count cap ${MIDDOT} results below may be incomplete.`,
      ),
    );
    lines.push('');
  }
  lines.push(
    `  ${bold('Maturity:')} ${levelPaint(bold(`L${report.level.index} ${MIDDOT} ${report.level.name}`))}` +
      `   ${bold('Score:')} ${report.score.earned}/${report.score.max} (${report.score.percent}%)` +
      dim(`   scopes: ${formatScopes(report.scopes.maturity)}`),
  );
  if (effectiveDiffers(report)) {
    const effPaint = LEVEL_COLOR[report.effective.level.index] ?? red;
    lines.push(
      `  ${bold('Effective:')} ${effPaint(bold(`L${report.effective.level.index} ${MIDDOT} ${report.effective.level.name}`))}` +
        `   ${bold('Score:')} ${report.effective.score.earned}/${report.effective.score.max} (${report.effective.score.percent}%)` +
        dim(`   scopes: ${formatScopes(report.scopes.effective)}`),
    );
  }
  if (report.gate === 'effective' && effectiveDiffers(report)) {
    lines.push(dim('  Gate: effective (--min-level uses the effective score)'));
  }
  const detected = report.detectedHarnesses ?? [];
  if (detected.length > 0) {
    lines.push(dim(`  Detected: ${detected.map(toolDisplayName).join(', ')}`));
  }
  lines.push('');
  for (const dimension of report.dimensions) {
    const pct = `${dimension.percent}%`.padStart(4);
    lines.push(
      `  ${dimension.title.padEnd(20)} ${bar(dimension.percent)} ${pct}  ${dim(`${dimension.earned}/${dimension.max} pts`)}`,
    );
    const mapping = report.frameworkMapping[dimension.id];
    if (mapping) {
      lines.push(
        dim(`      ↳ NIST: ${mapping.nistFunctions.join(', ')}`) +
          (mapping.owaspIds.length > 0 ? dim(` · OWASP: ${mapping.owaspIds.join(', ')}`) : ''),
      );
    }
  }
  lines.push('');

  const failed = report.checks.filter((c) => !c.passed);
  if (failed.length === 0) {
    lines.push(green(`  All checks passed ${MIDDOT} this repository is fully harnessed.`));
  } else {
    lines.push(bold(`  Improvements (${failed.length}):`));
    for (const check of failed) {
      lines.push(`   ${red(CROSS)} ${bold(check.id)} ${check.title} ${dim(`(+${check.points} pts)`)}`);
      lines.push(`     ${check.remediation}`);
      lines.push(`     ${dim(check.evidence)}`);
      lines.push(`     ${cyan(check.docsUrl)}`);
    }
  }
  lines.push('');
  if (report.level.nextLevelGaps.length > 0) {
    lines.push(`  ${bold(`To reach L${report.level.index + 1}:`)} ${report.level.nextLevelGaps.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
