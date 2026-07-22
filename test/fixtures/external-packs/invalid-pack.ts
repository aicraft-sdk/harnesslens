/**
 * Fixture module for `api.spec.ts`'s malformed-export failure test — its
 * default export is missing `checks`/`id`, so `runAudit`'s `resolvePackEntry`
 * string branch must reject it with a clear error instead of silently
 * accepting a bogus pack.
 */
const notAPack = { message: 'not a CheckPack — no id, no checks array' };

export default notAPack;
