# Hono / Astro Kubernetes-style health probes

Date: 2026-09-03

Implemented the shared public contract on the five Hono apex workers and the twelve Astro content surfaces:

- `GET /health`
- `GET /health/startups`
- `GET /health/livenesses`
- `GET /health/readinesses`

All four return `text/plain; charset=utf-8`, `Cache-Control: no-store`, no JSON, no HTML, no redirect, no auth.

## Commands

- `pnpm --dir app/docs run test` — 18 files, 104 tests, pass
- `pnpm --dir app/help run test` — 14 files, 79 tests, pass
- `pnpm --dir app/apex run test` — 19 files, 100 tests, pass
- `pnpm --dir app/docs run knip` / `lint` / `typecheck` — pass
- `pnpm --dir app/apex run knip` / `lint` / `typecheck` — pass
- `pnpm --dir app/apex run test:api` — 10 Hurl files, 73 requests, pass
- `pnpm exec vitest run --dir test tunnel-surface-identity.test.ts verify-edge-connectivity.test.ts` — pass
- `pnpm --dir app/docs run test:api` — failed: reused an already-listening `localhost:5406` that answered `500` for `/health` and other routes (stale Astro process PID 7647). Not re-run against a replacement server.

## Probe design

Startup, liveness, and readiness all inspect the Worker isolate only: if the handler ran, the process can serve. No Rails, CMS, KV, R2, or other network hop. A downstream outage cannot fail liveness. Readiness has no extra runtime dependency on these static/hybrid Workers; failure is injected only in unit tests.
