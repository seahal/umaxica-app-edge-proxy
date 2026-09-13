# Edge → Rails Health API migration

Date: 2026-09-03

## Paths

- Old Rails verification path: `GET /health/liveness.json`
- New Rails verification path: `GET /api/v0/health.json`
- Unchanged: each frame's `PRIVATE_RAILS_ORIGIN` / `Host` dispatch; one VPC Service
- Unchanged: Edge public `/health` is `text/plain` (not a JSON proxy of Rails)

## Affected frames

All fifteen Rails-backed frames: `{app,com,org}` × `{core,docs,help,info,news}`.

No `src-astro/` trees remain; Astro lives in `src/` for the twelve content surfaces, TanStack Start in `src/` for the three Cores. Apex workers stay Rails-blind.

## Consumer schema

Required fields only; additive top-level keys and extra `checks.*` entries are ignored.

- `status`: `pass` | `warn` | `fail`
- `checks.startup.status`, `checks.liveness.status`, `checks.readiness.status`: same vocabulary

HTTP pairing:

- `200` + `application/json` + `pass` → `pass`
- `200` + `application/json` + `warn` → `warn`
- `503` + `application/json` + `fail` → `fail`
- charset parameters allowed
- `200`+`fail`, `503`+`pass`/`warn`, non-JSON, missing fields, unknown status, redirects → `invalid-contract`

Transport:

- no binding → `not-configured`
- VPC / network / `ProxyError:` → `unreachable`
- other HTTP that is not the Health API pair → `http-error`

Public Edge mapping (`text/plain`): `pass` / `warn` / `not-configured` → readiness `ok`; `fail` / `unreachable` / `invalid-contract` / `http-error` → readiness `error`. Liveness stays isolate-only.

## Tests run

- `pnpm --dir app/docs run test` — pass
- `pnpm --dir app/core run test` — 334 tests, pass
- `pnpm -r run test` — pass
- `pnpm exec vitest run --dir test` — 13 files, 441 passed, 1 skipped
- `pnpm --dir app/docs run test:api` — 5 Hurl files, 33 requests, pass
- `pnpm --dir app/core run test:api` — 5 Hurl files, 26 requests, pass
- `pnpm --dir app/docs run typecheck` / `lint` / `knip` — pass (`lint:types` still fails on pre-existing `cms-bootstrap-probe.json.ts` assertion)
- `pnpm --dir app/core run typecheck` / `lint` / `lint:types` / `knip` — pass
- `pnpm -r run typecheck` / `knip` — pass
- `pnpm --dir app/docs run build` + `check:size` — 102.25 kB / 112 kB
- `pnpm --dir app/core run build` + `check:size` — 117.84 kB / 129 kB
- `git diff --check` — pass
- `pnpm run check:spelling` — 0 issues
- Root `pnpm run check` — failed on pre-existing `tools/verify-edge-connectivity.mjs` unicode-regexp / `eqeqeq` findings (unchanged in this work) and the docs CMS bootstrap assertion

## Real Workers VPC

Not verified. `EDGE_RAILS_NETWORK` unset; `http://docs.app.localhost:3000/api/v0/health.json` did not connect. Unit, invariant, and Hurl checks above do not substitute for a live VPC hop.

## Remaining old endpoint references

Active health verification code no longer contains `/health/liveness.json`. Remaining mentions are:

- Core public-FQDN block list (`core-dispatch.ts` and tests) — Rails operational JSON stays off the shared hostname
- Historical ADR 009 body, ADR 001, plans, older evidence, comments about a past RoutingError

## Remaining risks

- Production without a VPC binding still reports Edge readiness `ok` (`not-configured`), by design for the operational probe surface
- Live Rails Health API documents were not observed
