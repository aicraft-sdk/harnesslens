import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    cache: { dir: '../../node_modules/.vite/harness-audit' },
    environment: 'node',
    // Fixture repos under test/fixtures/** are scan targets, not our test suite —
    // exclude them so upstream fixture test files (e.g. level-3/src/greet.test.js)
    // never get collected as our own tests.
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: { reportsDirectory: '../../coverage/harness-audit', provider: 'v8' },
  },
});
