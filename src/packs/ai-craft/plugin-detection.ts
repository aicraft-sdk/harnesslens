/**
 * Detects a craftflow-style AI harness plugin delivered at a NON-repo-root
 * path — the false-negative core's `SKL-01`/`AGT-01`/`HKS-01` checks miss,
 * since they only look at repo-root standard paths (`.claude/skills/`,
 * `.claude/agents/`, `.claude/settings.json`, `.cursor/rules/`, etc.).
 *
 * Detection is STRUCTURAL, not name-coupled to any one plugin (e.g.
 * "craftflow"): a plugin bundle shape is `tools/<any>/plugins/<any>/...`,
 * following the same `ScanContext.matching(re)` path-pattern style already
 * used by `packs/core/skills.ts` (collectSkills) and `packs/core/ci.ts`
 * (WORKFLOW_RE) for repo-root harness detection.
 */

import { defineCheck } from '../../define.js';
import type { Check } from '../../types.js';

const PLUGIN_SKILL_RE = /(^|\/)tools\/[^/]+\/plugins\/[^/]+\/skills\/[^/]+\/SKILL\.md$/;
const PLUGIN_AGENT_RE = /(^|\/)tools\/[^/]+\/plugins\/[^/]+\/agents\/[^/]+\.md$/;
const PLUGIN_HOOKS_RE = /(^|\/)tools\/[^/]+\/plugins\/[^/]+\/hooks(?:\.json|\/hooks\.json)$/;

export const pluginDetectionChecks: Check[] = [
  defineCheck({
    id: 'AIC-01',
    dimension: 'company',
    title: 'Plugin-delivered skills detected (non-repo-root harness)',
    points: 4,
    remediation:
      'If your AI harness ships as a plugin (not repo-root .claude/skills/ or .cursor/skills/), place skills under tools/<plugin>/plugins/<name>/skills/<skill>/SKILL.md so audits credit them.',
    run(ctx) {
      const matches = ctx.matching(PLUGIN_SKILL_RE);
      return matches.length > 0
        ? { passed: true, evidence: `Found ${matches.length} plugin-delivered SKILL.md: ${matches.slice(0, 3).join(', ')}.` }
        : { passed: false, evidence: 'No tools/*/plugins/*/skills/*/SKILL.md found.' };
    },
  }),
  defineCheck({
    id: 'AIC-02',
    dimension: 'company',
    title: 'Plugin-delivered subagents detected (non-repo-root harness)',
    points: 3,
    remediation:
      'If your AI harness ships as a plugin, place subagent definitions under tools/<plugin>/plugins/<name>/agents/<agent>.md so audits credit them.',
    run(ctx) {
      const matches = ctx.matching(PLUGIN_AGENT_RE);
      return matches.length > 0
        ? { passed: true, evidence: `Found ${matches.length} plugin-delivered agent(s): ${matches.slice(0, 3).join(', ')}.` }
        : { passed: false, evidence: 'No tools/*/plugins/*/agents/*.md found.' };
    },
  }),
  defineCheck({
    id: 'AIC-03',
    dimension: 'company',
    title: 'Plugin-delivered hooks configuration detected (non-repo-root harness)',
    points: 3,
    remediation:
      'If your AI harness ships as a plugin, place its hooks config at tools/<plugin>/plugins/<name>/hooks.json (or hooks/hooks.json) so audits credit it.',
    run(ctx) {
      const matches = ctx.matching(PLUGIN_HOOKS_RE);
      return matches.length > 0
        ? { passed: true, evidence: `Found plugin-delivered hooks config: ${matches.slice(0, 3).join(', ')}.` }
        : { passed: false, evidence: 'No tools/*/plugins/*/hooks.json (or hooks/hooks.json) found.' };
    },
  }),
];
