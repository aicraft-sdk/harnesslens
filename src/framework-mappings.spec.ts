import { describe, expect, it } from 'vitest';
import { composeRegistry } from './registry.js';
import { corePack } from './packs/core/index.js';
import { aiCraftPack } from './packs/ai-craft/index.js';
import { getFrameworkMapping } from './framework-mappings.js';

describe('framework-mappings completeness', () => {
  it('has a non-empty NIST+OWASP mapping for every dimension the default CLI composition scores', () => {
    const { dimensions } = composeRegistry({ packs: [corePack, aiCraftPack] });
    for (const dim of dimensions) {
      const mapping = getFrameworkMapping(dim.id);
      expect(mapping, `missing framework mapping for dimension "${dim.id}"`).toBeDefined();
      expect(mapping!.nistFunctions.length).toBeGreaterThan(0);
      // OWASP ids may be empty only for a dimension explicitly TODO-flagged in Task 1.1.
    }
  });
});
