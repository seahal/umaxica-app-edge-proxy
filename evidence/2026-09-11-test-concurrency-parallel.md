# Restore parallel `pnpm run test`

Date: 2026-09-11

`pnpm run test` was serialised on 2026-09-10 (`--workspace-concurrency=1` ×
`maxWorkers: 1`) because this container's `pids.max` is 2048 and concurrent
Vitest forks hit `spawn … EAGAIN`. Wall time of the full unit fan-out became
too slow, so the 2026-09-07 topology is restored.

## Change

- Root `test` / `test:stress`: `--workspace-concurrency=4`
- Root invariant Vitest: no `--maxWorkers=1` (Vitest default workers)
- All twenty unit `vitest.config.ts`: `maxWorkers: 2`

Effective ceiling is again 4 units × 2 workers = 8 concurrent Vitest workers.
This is a process-budget / wall-time change, not a test-correctness change.

If `EAGAIN` returns while other Vite/Astro processes already fill the PID
cgroup, stop those processes or raise `pids.max` rather than re-serialising
the suite.

## Verification

`pnpm run test` — exit 0, wall ~20.5 s (four units at a time, then the root
invariant suite). No `EAGAIN` on this run.
