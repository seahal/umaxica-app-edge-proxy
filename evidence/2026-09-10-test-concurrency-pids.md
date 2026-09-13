# Test concurrency lowered for cgroup PID budget

Date: 2026-09-10

This container's `pids.max` is 2048. With Vite/Astro already running, `pids.current` sat near 1860. `pnpm run test` (`--workspace-concurrency=4` × Vitest `maxWorkers: 2`, plus isolated forks) failed to spawn workers:

`spawn /usr/local/bin/node EAGAIN`

## Change

- Root `test` / `test:stress`: `--workspace-concurrency=1`
- Root invariant Vitest: `--maxWorkers=1`
- All twenty unit `vitest.config.ts`: `maxWorkers: 1`

Effective ceiling is one unit × one worker, instead of 4 × 2 = 8.

This is a process-budget bound, not a test-correctness change. Assertions are unchanged.
