# Astro CMS SSR over the dedicated Workers VPC path

Date: 2026-09-05

## What was verified

A real Rails publishing document reached `app/docs` through Workers VPC and appeared in the
initial HTML. No public Rails Tunnel was used.

Path:

```
local workerd (astro dev --env vpc)
  → Workers VPC binding UMAXICA_APPS_EDGE_CF_WORKERS_VPC
  → VPC Service 01a06fd0-89b7-7613-9e1d-f7d07c693273 (umaxica-dev-rails-api)
  → dedicated tunnel 03a4a67c-2aca-4f2c-9aeb-d1666f18bc87
  → core-workers-vpc.internal:3000
  → Rails Docs::App public entries API
  → GET /ja/welcome SSR HTML
```

Rails ran in Podman (`global-devcontainer-core` + `bin/dev`). The dedicated connector was
`umaxica-apps-global-dc_cloudflare-tunnel-workers-vpc_1`.

## Observations

- `node tools/verify-edge-connectivity.mjs vpc`: Direct VPC → Rails `200` for all fifteen surfaces
  on service `01a06fd0-…`. Identity WARN remains: `/api/v0/health.json` has no `namespace` field.
- Inside Global core: `getent hosts core-workers-vpc.internal` → `10.89.3.3`.
  `Host: docs.app.localhost` + `http://core-workers-vpc.internal:3000/api/v0/health.json` →
  `{"status":"pass",…}`. Sending `Host: core-workers-vpc.internal` is blocked by Rails
  Host Authorization (routing alias only).
- Rails index `GET /api/v0/entries?locale=ja&limit=1` returned slug `welcome`,
  `public_id` `httS4Y6517f1XS9SMK0Lu`, title `Docs app (ja)`.
- Rails show is keyed by `public_id`, not slug. `createCmsClient` therefore lists the index,
  matches the public slug, then fetches `/api/v0/entries/:public_id`.
- `GET http://127.0.0.1:5409/ja/welcome` → `200` HTML containing
  `<h1>Docs app (ja)</h1>`, the summary, and `Docs app (ja) body` in the first response.
  Canonical: `https://docs-jp.umaxica.app/ja/welcome/`. No `core-workers-vpc.internal` and no
  `:3000` origin in the document.
- Missing slug `GET /ja/does-not-exist-xyz` → generic Edge `404` HTML, no Rails body.
- `GET /health` → `text/plain` operational probe. `GET /revision` → version id `text/plain`.
  Structured JSON remains `GET /api/v0/revision.json` (`id`, `tag`, `timestamp`).

## TanStack

`app/core` `dev:vpc` could not open a second `edge-preview` remote session (API `10000`) while
Astro already held one. The same VPC Service already answered `APP/CORE` health `200` in
`verify-edge-connectivity.mjs vpc`. `app/core` rails-client/rails-health unit tests: 31 passed.

## Commands

```bash
podman compose -p umaxica-apps-global-dc up -d primary replica valkey-cache valkey-rate-limit core cloudflare-tunnel-workers-vpc
podman exec -d global-devcontainer-core bash -lc 'bin/dev'
CLOUDFLARE_API_TOKEN= node tools/verify-edge-connectivity.mjs vpc
CLOUDFLARE_API_TOKEN= pnpm --dir app/docs run dev:vpc
# HTTP checks against 127.0.0.1:5409
podman exec umaxica-apps-edge-core-1 bash -lc 'pnpm --dir app/docs exec vitest run test/lib/cms-client.test.ts'
```
