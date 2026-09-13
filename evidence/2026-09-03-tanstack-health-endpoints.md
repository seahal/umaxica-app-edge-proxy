# TanStack Start health endpoints

Date: 2026-09-03

TanStack Start deployable units in this repository are only the three Cores:
`app/core`, `com/core`, `org/core`. The twelve docs/help/info/news surfaces are
Astro, not TanStack Start.

Implemented the shared public contract:

- `GET /health`
- `GET /health/startups`
- `GET /health/livenesses`
- `GET /health/readinesses`

All four are TanStack Server Routes returning `text/plain; charset=utf-8` and
`Cache-Control: no-store`. JSON health on Core is gone.

## Verified

- `pnpm --dir app/core run test` — 22 files, 319 tests, pass
- `pnpm --dir com/core run test` — pass
- `pnpm --dir org/core run test` — pass
- `pnpm --dir app/core run format`, `lint`, `lint:types`, `knip`, `typecheck` — pass
- `pnpm --dir app/core run build` — pass (regenerated `src/routeTree.gen.ts`)
- `pnpm --dir app/core run check:size` — 117.76 kB gzipped / 129 kB limit
- `pnpm --dir app/core run test:api` — 5 Hurl files, 26 requests, including
  `api/health.hurl` (4 probe URLs), pass
- `git diff --check` — pass
- `pnpm exec vitest run --dir test core-dispatch-contract.test.ts` — pass

## Not verified

- Cloudflare production/preview deployment
- Kubernetes manifests (none in this repository)
- `pnpm --dir com/core run test:api` / `org/core` Hurl (same files as app/core;
  only app/core was run against a live server)

## Pre-existing unrelated failure

`test/rails-connection-invariants.test.ts` still fails
`keeps all fifteen Rails health probes byte-identical` because
`app/docs/src/lib/rails-health.ts` already diverged (CMS work). Not changed here.
