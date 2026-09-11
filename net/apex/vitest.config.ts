// Vitest configuration for ONE deployment unit.
//
// Deliberately self-contained: it extends nothing at the repository root, so
// this directory stays runnable if it is ever extracted into its own
// repository. The mocks under test/__mocks__ are this unit's own copies —
// per CLAUDE.md, duplication across frames is intentional, so that one frame's
// test requirements never force a change in another frame.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    coverage: {
      exclude: [
        '**/+types/**',
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/node_modules/**',
        '**/build/**',
        '**/dist/**',
        '**/__mocks__/**',
        '**/public/**',
        '**/*.css',
        '**/*.svg',
        '**/locales/**',
        '**/coverage/**',
        '**/.wrangler/**',
        '**/e2e/**',
        '**/playwright.config.ts',
        '**/vitest.config.ts',
        '**/vitest.setup.ts',
        // Browser-rendered entry and UI modules belong to Playwright/Hurl, not
        // Vitest; coverage must measure only the internal-logic layer.
        '**/src/index.tsx',
        '**/src/page-content.tsx',
        '**/src/renderer.tsx',
        '**/src/shell.tsx',
      ],
      include: ['src/**/*.{ts,tsx,js,jsx}'],
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
    include: ['test/**/*.test.{ts,tsx}'],
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
