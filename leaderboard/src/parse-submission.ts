/**
 * Allowlist submission parser. SECURITY: always constructs a NEW object from
 * named fields — never spreads/Object.assign's the raw parsed JSON — so an
 * attacker-controlled submissions/<repoId>.json cannot mass-assign or pollute
 * anything beyond the 7 fields explicitly read below.
 */
import type { ValidatedSubmission } from './types.js';

export type ParseResult =
  | { ok: true; entry: ValidatedSubmission }
  | { ok: false; file: string; reason: string };

const REPO_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseSubmission(raw: unknown, file: string): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, file, reason: 'submission is not a JSON object' };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r['repoId'] !== 'string' || !REPO_ID_RE.test(r['repoId'])) {
    return { ok: false, file, reason: 'missing or unsafe "repoId" (expected "org/repo" shape)' };
  }
  if (!isFiniteNumber(r['score'])) {
    return { ok: false, file, reason: 'missing or non-numeric "score"' };
  }
  const level = r['level'];
  if (
    typeof level !== 'object' || level === null ||
    !isFiniteNumber((level as Record<string, unknown>)['index']) ||
    typeof (level as Record<string, unknown>)['name'] !== 'string'
  ) {
    return { ok: false, file, reason: 'missing or malformed "level" (expected { index, name })' };
  }
  const dimensionsRaw = r['dimensions'];
  if (!Array.isArray(dimensionsRaw)) {
    return { ok: false, file, reason: 'missing or non-array "dimensions"' };
  }
  const dimensions: ValidatedSubmission['dimensions'] = [];
  for (const d of dimensionsRaw) {
    if (
      typeof d !== 'object' || d === null ||
      typeof (d as Record<string, unknown>)['id'] !== 'string' ||
      // Defense-in-depth: matches the same guard already applied to frameworkMapping keys.
      // dimension.id is later used as a bracket-lookup key against a plain object in
      // render.ts's mappingSummary() — "__proto__"/"constructor"/"prototype" would fall through
      // the prototype chain there instead of missing cleanly.
      ['__proto__', 'constructor', 'prototype'].includes((d as Record<string, unknown>)['id'] as string) ||
      typeof (d as Record<string, unknown>)['title'] !== 'string' ||
      !isFiniteNumber((d as Record<string, unknown>)['earned']) ||
      !isFiniteNumber((d as Record<string, unknown>)['max']) ||
      !isFiniteNumber((d as Record<string, unknown>)['percent'])
    ) {
      return { ok: false, file, reason: 'malformed entry in "dimensions" array' };
    }
    const dd = d as Record<string, unknown>;
    dimensions.push({
      id: dd['id'] as string,
      title: dd['title'] as string,
      earned: dd['earned'] as number,
      max: dd['max'] as number,
      percent: dd['percent'] as number,
    });
  }
  const frameworkMappingRaw = r['frameworkMapping'];
  if (typeof frameworkMappingRaw !== 'object' || frameworkMappingRaw === null || Array.isArray(frameworkMappingRaw)) {
    return { ok: false, file, reason: 'missing or malformed "frameworkMapping"' };
  }
  // Deliberate fail-open choice for frameworkMapping (unlike dimensions[], which fails the
  // whole submission closed on malformed entries): frameworkMapping is supplementary/display
  // metadata (NIST/OWASP tags shown alongside a dimension), not the scored data itself. Losing
  // one malformed mapping only loses a display label; dimensions[] IS the scored data, so a
  // malformed entry there must reject the whole submission instead of shipping partial scores.
  const frameworkMapping: ValidatedSubmission['frameworkMapping'] = {};
  for (const [key, value] of Object.entries(frameworkMappingRaw as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (
      typeof value !== 'object' || value === null ||
      !Array.isArray((value as Record<string, unknown>)['nistFunctions']) ||
      !Array.isArray((value as Record<string, unknown>)['owaspIds'])
    ) {
      continue; // Unknown/malformed dimension entries inside frameworkMapping are dropped, not fatal.
    }
    const nistFunctionsRaw = (value as Record<string, unknown>)['nistFunctions'] as unknown[];
    const owaspIdsRaw = (value as Record<string, unknown>)['owaspIds'] as unknown[];
    if (
      !nistFunctionsRaw.every((v) => typeof v === 'string') ||
      !owaspIdsRaw.every((v) => typeof v === 'string')
    ) {
      // Non-string array elements (e.g. [{}, null]) must not be blindly coerced via
      // .map(String) — that would silently turn garbage into shipped strings like
      // "[object Object]"/"null". Drop this entry instead, same as any other malformed shape.
      continue;
    }
    frameworkMapping[key] = {
      nistFunctions: [...nistFunctionsRaw] as string[],
      owaspIds: [...owaspIdsRaw] as string[],
    };
  }
  if (typeof r['commitSha'] !== 'string' || !SHA_RE.test(r['commitSha'])) {
    return { ok: false, file, reason: 'missing or malformed "commitSha"' };
  }
  if (typeof r['scannedAt'] !== 'string' || Number.isNaN(Date.parse(r['scannedAt']))) {
    return { ok: false, file, reason: 'missing or unparseable "scannedAt"' };
  }

  return {
    ok: true,
    entry: {
      repoId: r['repoId'],
      score: r['score'],
      level: { index: (level as Record<string, unknown>)['index'] as number, name: (level as Record<string, unknown>)['name'] as string },
      dimensions,
      frameworkMapping,
      commitSha: r['commitSha'],
      scannedAt: r['scannedAt'],
    },
  };
}
