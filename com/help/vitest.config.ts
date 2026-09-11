import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'import.meta.env.MODE': JSON.stringify('test'),
  },
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./test/__mocks__/cloudflare-workers.ts', import.meta.url),
      ),
      'astro:env/client': fileURLToPath(
        new URL('./test/__mocks__/astro-env-client.ts', import.meta.url),
      ),
      'astro:middleware': fileURLToPath(
        new URL('./test/__mocks__/astro-middleware.ts', import.meta.url),
      ),
    },
    tsconfigPaths: true,
  },
  test: {
    coverage: {
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/__mocks__/**',
        '**/public/**',
        '**/*.css',
        '**/*.astro',
        '**/coverage/**',
        '**/.wrangler/**',
        '**/e2e/**',
        '**/playwright.config.ts',
        '**/vitest.config.ts',
        '**/vitest.setup.ts',
        '**/astro.config.mjs',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // A small uncovered file must not hide behind a large covered one.
      // Vitest 5: per-file floors live on `thresholds`, not CoverageOptions.
      thresholds: {
        perFile: true,
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    deps: {
      interopDefault: true,
    },
    environment: 'happy-dom',
    globals: true,
    include: ['test/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // --- Hardened execution contract -----------------------------------------
    // Identical across all twenty deployment units and kept inline in each,
    // never a shared import or root config, so the directory stays independently
    // runnable and extractable (test/deployment-unit-boundaries.test.ts).
    // Rationale and the concurrency benchmark: evidence/2026-09-07-vitest-hardening.md.
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
    isolate: true,
    fileParallelism: true,
    // Bounded because up to four units run at once under the root `pnpm -r`
    // fan-out (`--workspace-concurrency=4`); workspace concurrency x maxWorkers
    // is the real worker ceiling (4 x 2 = 8). Vitest 5 dropped `minWorkers`;
    // `maxWorkers: 2` is the per-unit ceiling.
    maxWorkers: 2,
    maxConcurrency: 4,
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    dangerouslyIgnoreUnhandledErrors: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    teardownTimeout: 10_000,
    slowTestThreshold: 300,
    // Normal runs are deterministic order, non-concurrent. The stress loop
    // (`pnpm run test:stress`) turns shuffling on from the CLI instead, so an
    // order-dependency bug surfaces there rather than flaking the fast loop.
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});
