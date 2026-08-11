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
    frameworkMapping[key] = {
      nistFunctions: [...((value as Record<string, unknown>)['nistFunctions'] as unknown[])].map(String),
      owaspIds: [...((value as Record<string, unknown>)['owaspIds'] as unknown[])].map(String),
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
