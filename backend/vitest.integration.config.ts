import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // The DI-probe regression guard lives under src/ (Task 0.2) so it stays colocated with the
    // unit config it also runs under; it is the one explicit exception to the e2e/integration-only
    // globs below, added individually (not via a broad src/**/*.spec.ts pattern) so later unit
    // specs are never accidentally picked up by the integration run.
    include: [
      'test/e2e/**/*.e2e-spec.ts',
      'test/integration/**/*.int-spec.ts',
      'src/common/di-probe.spec.ts',
    ],
    environment: 'node',
    testTimeout: 30_000,
  },
});
