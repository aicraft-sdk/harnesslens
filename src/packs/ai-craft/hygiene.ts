/**
 * Repo hygiene gaps this audit's own manual pass surfaced in this repo:
 * a root LICENSE and a `.env.example` template. General-purpose checks —
 * any target repo can trip them, not just this one.
 *
 * AIC-09 (root LICENSE) is detection-logic-identical to core's `HYG-05` —
 * kept per the phase contract (only the ESLint/`.github/workflows` checks
 * were left to judgment) and scored under the `company` dimension rather
 * than `hygiene`, so it doesn't double-count core's hygiene subtotal; see
 * the ai-craft pack's README/report notes for the redundancy disclosure.
 *
 * AIC-10 (`.env.example` template) is NOT a duplicate: core's `HYG-02`/
 * `HYG-03` check that `.gitignore` covers `.env` and that no unignored
 * `.env` files leak into the tree — neither checks that a template exists
 * for contributors to copy from.
 */

import { defineCheck } from '../../define.js';
import type { Check, ScanContext } from '../../types.js';

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];
const ENV_TEMPLATE_FILES = ['.env.example', '.env.sample', '.env.template'];

function gitignoreCoversEnv(ctx: ScanContext): boolean {
  const content = ctx.read('.gitignore');
  if (content === null) return false;
  return content.split(/\r?\n/).some((l) => /^\s*\*?\*?\/?\.env/.test(l.trim()));
}

export const hygieneChecks: Check[] = [
  defineCheck({
    id: 'AIC-09',
    dimension: 'company',
    title: 'Root LICENSE present (company convention)',
    points: 2,
    remediation: 'Add a LICENSE file at the repository root — required for open-source distribution.',
    run(ctx) {
      const found = LICENSE_FILES.find((f) => ctx.has(f));
      return found
        ? { passed: true, evidence: `Found ${found}.` }
        : { passed: false, evidence: 'No LICENSE file at repository root.' };
    },
  }),
  defineCheck({
    id: 'AIC-10',
    dimension: 'company',
    title: '.env.example template present when .gitignore covers .env',
    points: 2,
    remediation:
      'When .gitignore excludes .env files, commit a .env.example (or .env.sample/.env.template) so contributors know what to configure.',
    run(ctx) {
      if (!gitignoreCoversEnv(ctx)) {
        return { passed: true, evidence: '.gitignore does not reference .env patterns (nothing to template).' };
      }
      const found = ENV_TEMPLATE_FILES.find((f) => ctx.has(f));
      return found
        ? { passed: true, evidence: `.gitignore covers .env; found template ${found}.` }
        : {
            passed: false,
            evidence:
              '.gitignore covers .env but no .env.example/.env.sample/.env.template template found.',
          };
    },
  }),
];
