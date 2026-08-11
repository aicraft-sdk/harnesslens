/**
 * Data-driven crosswalk from harness-audit dimensions to NIST AI RMF functions
 * and OWASP's Agentic AI Top 10 (2026). "Maps to" / "aligned to" language only
 * — never "certified" or "ISO-compliant" (see no-certification-claims.spec.ts).
 * Sources: NIST AI RMF 1.0 (nist.gov/itl/ai-risk-management-framework) — the
 * 4 functions (Govern, Map, Measure, Manage) are well-established and require
 * no further confirmation.
 * OWASP Agentic AI Top 10 (OWASP GenAI Security Project, published 2025-12-09,
 * updated to v2.01 2026-06-01) — direct fetches of genai.owasp.org's Agentic
 * Security Initiative page did not render an enumerable ASI01–ASI10 list
 * (JS-rendered / rate-limited); the list below was cross-verified against 3
 * independent secondary sources that all converged on the identical ordered
 * ASI01–ASI10 IDs and titles: https://neuraltrust.ai/blog/owasp-agentic-ai-top-10,
 * https://pharosproduction.com/insights/engineering/owasp-agentic-top-10-2026/,
 * https://isitpatched.com/what-is-owasp-agentic-top-10. Official framework
 * landing page: https://genai.owasp.org/initiatives/agentic-security-initiative/.
 * ASI01 Agent Goal Hijack, ASI02 Tool Misuse and Exploitation, ASI03 Identity
 * and Privilege Abuse, ASI04 Agentic Supply Chain Vulnerabilities, ASI05
 * Unexpected Code Execution, ASI06 Memory and Context Poisoning, ASI07
 * Insecure Inter-Agent Communication, ASI08 Cascading Failures, ASI09
 * Human-Agent Trust Exploitation, ASI10 Rogue Agents.
 */
import type { DimensionId } from './types.js';

export type NistAiRmfFunction = 'Govern' | 'Map' | 'Measure' | 'Manage';

export interface FrameworkMapping {
  nistFunctions: NistAiRmfFunction[];
  owaspIds: string[];
}

export const FRAMEWORK_MAPPING_VERSION = '2026-08-11';

export const FRAMEWORK_MAPPINGS: Record<string, FrameworkMapping> = {
  // Context/guide files set agent goals (ASI01 Agent Goal Hijack) and are the
  // substrate agentic memory/context poisoning targets (ASI06).
  context: { nistFunctions: ['Govern', 'Map'], owaspIds: ['ASI01', 'ASI06'] },
  // Skills/commands are the tools an agent invokes (ASI02 Tool Misuse and
  // Exploitation) and often execute code directly (ASI05).
  skills: { nistFunctions: ['Map', 'Manage'], owaspIds: ['ASI02', 'ASI05'] },
  // Hooks are the guardrail layer that blocks unexpected code execution
  // (ASI05) and stops a single failure from cascading (ASI08).
  hooks: { nistFunctions: ['Manage'], owaspIds: ['ASI05', 'ASI08'] },
  // Sensors/feedback loops exist to catch failures before they cascade.
  sensors: { nistFunctions: ['Measure'], owaspIds: ['ASI08'] },
  // CI enforces supply-chain integrity checks (ASI04) and catches
  // regressions before they compound (ASI08).
  ci: { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI04', 'ASI08'] },
  // Hygiene/safety checks (secrets, permission scoping) map to Identity and
  // Privilege Abuse (ASI03).
  hygiene: { nistFunctions: ['Govern', 'Manage'], owaspIds: ['ASI03'] },
  // Governance/traceability conventions establish the human-oversight and
  // accountability trail that guards against Human-Agent Trust Exploitation.
  company: { nistFunctions: ['Govern'], owaspIds: ['ASI09'] },
  // The exit-gate validates agent output still matches the intended goal
  // (ASI01) and is the last line of defense against a rogue agent (ASI10).
  'exit-gate': { nistFunctions: ['Measure', 'Manage'], owaspIds: ['ASI01', 'ASI10'] },
};

export function getFrameworkMapping(dimensionId: DimensionId): FrameworkMapping | undefined {
  return FRAMEWORK_MAPPINGS[dimensionId];
}
