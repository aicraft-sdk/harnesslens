import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    cache: { dir: '../../node_modules/.vite/harness-audit-leaderboard' },
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    reporters: ['default'],
    coverage: { reportsDirectory: '../../coverage/harness-audit-leaderboard', provider: 'v8' },
  },
});
