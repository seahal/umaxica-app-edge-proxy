# 2026-09-11 — Cores reach Rails at `RAILS_ORIGIN`, without Workers VPC

Verification of the change recorded in `adr/018-core-rails-direct-internet.md`
(`{app,com,org}/core` only; the twelve Astro surfaces keep Workers VPC).

## Static and unit checks

| Command                                      | Result                                          |
| -------------------------------------------- | ----------------------------------------------- |
| `pnpm run check`                             | exit 0; check-workers OK (20 workers); CSpell 0 |
| `pnpm exec vitest run --dir test`            | 17 files, 582 tests passed                      |
| `pnpm --dir {app,com,org}/core run test`     | 340 / 340 / 347 tests passed                    |
| `pnpm --dir {app,com,org}/core run build`    | exit 0 for all three                            |
| `pnpm --dir {app,com,org}/core run test:api` | 7 of 7 Hurl files passed for each               |

Built `dist/server/wrangler.json` for all three Cores: `"vpc_services":[]`,
zero occurrences of `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`, and no `RAILS_ORIGIN`
(production names none yet).

## Local opt-in, measured against `app/core` `vite dev`

Each row used a freshly started server (distinct PIDs 2538502, 2538769,
2539137, 2539410), stopped and confirmed gone before the next.
`http://nothing.localhost:1` is a valid but unreachable origin.

| Configuration                                                                              | `GET /health`           |
| ------------------------------------------------------------------------------------------ | ----------------------- |
| `env.local` declares `RAILS_ORIGIN` (temporary edit)                                       | 503, `readiness: error` |
| nothing set                                                                                | 200, `readiness: ok`    |
| `RAILS_ORIGIN` exported in the shell, forwarded by a temporary `vite.config.ts` customizer | 503, `readiness: error` |
| `RAILS_ORIGIN` in `.dev.vars`                                                              | 503, `readiness: error` |

`.dev.vars` reaches the Worker, so the forwarding customizer was removed and the
local opt-in is `.dev.vars` (line provided in `.dev.vars.example`).

Earlier runs in the same session reported 200 for every configuration. They
were invalid and are not evidence: the cleanup pattern did not match the real
`node …/vite/bin/vite.js dev` process, so a stale server kept answering on
port 5405 (a later start failed with `EADDRINUSE 127.0.0.1:9405`).

## Not verified

- A real Rails answering over the public internet: no public Rails host exists,
  and no tier names a `RAILS_ORIGIN` yet.
- Rails' Host Authorization for the `RAILS_ORIGIN` host (Rails repository).
- `pnpm --dir <core> run test:cov` still fails its 100% threshold on
  `src/lib/rails-health.ts` lines 166, 172, 194 and 198. That file and its test
  are unchanged by this work: the "checks is %s" cases in
  `test/lib/rails-health.test.ts` send no `timestamp`, so parsing stops before
  the `checks` branches.
