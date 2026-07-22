/**
 * AI-First governance checks: a substantive root charter file (mirroring
 * core's `CTX-02` "≥20 lines + ≥2 headings" rigor) plus a `docs/ai/specs/`
 * directory, and genuine content-scanning spec-traceability checks (FR-###/
 * SC-### identifiers, and a flag — not a hard fail — for unresolved
 * `[NEEDS CLARIFICATION]` markers).
 */

import { defineCheck } from '../../define.js';
import type { Check, ScanContext } from '../../types.js';
import { countHeadings, nonEmptyLines } from '../../util.js';

const CHARTER_FILE_RE = /^(AI_FIRST|CHARTER)\.md$/;
const SPEC_FILE_RE = /(^|\/)docs\/ai\/specs\/[^/]+\.md$/;
const FR_ID_RE = /\bFR-\d+/;
const SC_ID_RE = /\bSC-\d+/;
const NEEDS_CLARIFICATION_RE = /\[NEEDS CLARIFICATION\]/g;

function findCharterFile(ctx: ScanContext): string | undefined {
  return ctx.files.find((f) => CHARTER_FILE_RE.test(f));
}

function specFiles(ctx: ScanContext): string[] {
  return ctx.matching(SPEC_FILE_RE);
}

export const governanceChecks: Check[] = [
  defineCheck({
    id: 'AIC-06',
    dimension: 'company',
    title: 'AI-First governance charter + docs/ai/specs present',
    points: 4,
    remediation:
      'Add a substantive AI_FIRST.md (or CHARTER.md) at the repository root (aim for 20+ meaningful lines with 2+ headings) plus a docs/ai/specs/ directory for feature specs.',
    run(ctx) {
      const charter = findCharterFile(ctx);
      const hasSpecsDir = ctx.files.some((f) => /(^|\/)docs\/ai\/specs\//.test(f));
      if (!charter) {
        return { passed: false, evidence: 'No AI_FIRST.md or CHARTER.md at repository root.' };
      }
      const content = ctx.read(charter) ?? '';
      const lines = nonEmptyLines(content);
      const headings = countHeadings(content);
      const substantive = lines >= 20 && headings >= 2;
      if (!substantive) {
        return {
          passed: false,
          evidence: `${charter}: ${lines} non-empty lines, ${headings} headings (needs ≥20 lines and ≥2 headings).`,
        };
      }
      if (!hasSpecsDir) {
        return { passed: false, evidence: `${charter} is substantive but no docs/ai/specs/ directory found.` };
      }
      return {
        passed: true,
        evidence: `${charter}: ${lines} non-empty lines, ${headings} headings; docs/ai/specs/ present.`,
      };
    },
  }),
  defineCheck({
    id: 'AIC-07',
    dimension: 'company',
    title: 'Spec traceability — FR-###/SC-### identifiers used',
    points: 3,
    remediation:
      'Number functional requirements FR-### and success criteria SC-### in your specs (docs/ai/specs/) so plans and verifier scenarios can reference stable IDs.',
    run(ctx) {
      const specs = specFiles(ctx);
      if (specs.length === 0) {
        return { passed: false, evidence: 'No spec files found under docs/ai/specs/.' };
      }
      const traced = specs.find((f) => {
        const content = ctx.read(f) ?? '';
        return FR_ID_RE.test(content) && SC_ID_RE.test(content);
      });
      return traced
        ? { passed: true, evidence: `${traced} contains FR-### and SC-### identifiers.` }
        : { passed: false, evidence: `None of ${specs.length} spec file(s) contain both FR-### and SC-### identifiers.` };
    },
  }),
  defineCheck({
    id: 'AIC-08',
    dimension: 'company',
    title: 'No unresolved [NEEDS CLARIFICATION] markers in specs (flag only)',
    points: 1,
    remediation:
      'Resolve any [NEEDS CLARIFICATION] marker left in docs/ai/specs/ before a plan is approved — this check reports them but never fails the audit.',
    run(ctx) {
      const specs = specFiles(ctx);
      let count = 0;
      for (const f of specs) {
        const content = ctx.read(f) ?? '';
        count += content.match(NEEDS_CLARIFICATION_RE)?.length ?? 0;
      }
      return {
        passed: true,
        evidence:
          count > 0
            ? `Found ${count} unresolved [NEEDS CLARIFICATION] marker(s) across ${specs.length} spec file(s) — informational, not blocking.`
            : `Found 0 unresolved [NEEDS CLARIFICATION] marker(s) across ${specs.length} spec file(s).`,
      };
    },
  }),
];
