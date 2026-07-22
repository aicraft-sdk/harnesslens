/**
 * Company release/monorepo conventions: NX workspace structure and a
 * changesets-based release flow (this repo's convention, replacing plain
 * `npm publish`). General-purpose — any repo can trip these, not just this
 * monorepo.
 */

import { defineCheck } from '../../define.js';
import type { Check } from '../../types.js';

const PROJECT_JSON_RE = /(^|\/)project\.json$/;

export const monorepoChecks: Check[] = [
  defineCheck({
    id: 'AIC-04',
    dimension: 'company',
    title: 'NX monorepo structure present',
    points: 3,
    remediation:
      'Add nx.json at the repository root and a project.json under each package/tool directory so NX recognizes the workspace structure.',
    run(ctx) {
      const hasNxJson = ctx.has('nx.json');
      const projectJsons = ctx.matching(PROJECT_JSON_RE);
      if (hasNxJson && projectJsons.length > 0) {
        return {
          passed: true,
          evidence: `nx.json present; ${projectJsons.length} project.json found (e.g. ${projectJsons[0]}).`,
        };
      }
      if (!hasNxJson && projectJsons.length === 0) {
        return { passed: false, evidence: 'No nx.json and no project.json found.' };
      }
      return {
        passed: false,
        evidence: hasNxJson
          ? 'nx.json present but no project.json found under any package/tool directory.'
          : `project.json found (e.g. ${projectJsons[0]}) but no root nx.json.`,
      };
    },
  }),
  defineCheck({
    id: 'AIC-05',
    dimension: 'company',
    title: 'Changesets release convention in use',
    points: 2,
    remediation:
      'Add .changeset/config.json (via `pnpm changeset init` or equivalent) — this is the company release convention, replacing plain `npm publish`.',
    run(ctx) {
      return ctx.has('.changeset/config.json')
        ? { passed: true, evidence: '.changeset/config.json found.' }
        : { passed: false, evidence: 'No .changeset/config.json found.' };
    },
  }),
];
