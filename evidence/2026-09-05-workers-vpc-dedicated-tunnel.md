# Workers VPC Migrated to a Dedicated Tunnel

Date: 2026-09-05

Repositories:

- `umaxica-apps-edge` at `aad05824` (working tree, uncommitted)
- `umaxica-apps-global` at `0c254469` (working tree, uncommitted) — connector and alias

## Why

`adr/006-development-workers-vpc-transport.md` recorded the account's single VPC Service
`019f5fe0-287f-7040-9f2f-036cb5b21df7` as terminating on `core.app.localhost:3000` over tunnel
`1d501e9a-62f7-4c0d-ba5e-a26e3f10088f`. Two of those three facts were wrong or fragile:

1. `wrangler vpc service list` reported the host as **`10.89.2.2`** — a Podman-assigned container
   address that changes whenever the network is recreated, not a hostname.
2. The cause: on the Global project's `frontend` network, `getent hosts core.app.localhost` answers
   `::1`. RFC 6761 reserves the `localhost.` domain and glibc resolves anything under it to loopback
   before a container resolver is consulted, so no `*.localhost` alias can be a VPC Service target.
3. Tunnel `1d501e9a-…` is `Auth`, which also serves the ten published browser hostnames behind
   Access. Every ingress, replica or token change there moved the Edge Worker's only route to Rails.

## What changed

|             | Before                                          | After                                                                        |
| :---------- | :---------------------------------------------- | :--------------------------------------------------------------------------- |
| VPC Service | `019f5fe0-…` `umaxica-apps-edge-cf-workers-vpc` | `01a06fd0-89b7-7613-9e1d-f7d07c693273` `umaxica-dev-rails-api`               |
| Tunnel      | `1d501e9a-…` `Auth` (shared)                    | `03a4a67c-2aca-4f2c-9aeb-d1666f18bc87` `umaxica-dev-workers-vpc` (dedicated) |
| Target      | `10.89.2.2` HTTP:3000                           | `core-workers-vpc.internal` HTTP:3000                                        |
| Binding     | `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`              | unchanged                                                                    |

The new tunnel has no ingress rules, no public hostname and no Access application. Cloudflare routes
Workers VPC traffic from the VPC Service record rather than tunnel ingress, so a locally managed
tunnel needs no ingress configuration
(<https://developers.cloudflare.com/workers-vpc/configuration/tunnel/>).

Sixteen `wrangler.jsonc` files (47 `service_id` occurrences) and `tools/workers-manifest.json` were
repointed. No binding name and no application code changed. The old service id also appears in
`adr/005`, `adr/006`, three `*/test/lib/rails-*.test.ts` files and an earlier evidence record; none
were rewritten — the test occurrences are `LEAK_MARKERS` fixtures, and the rest are historical.
`adr/006` carries a dated amendment instead.

## Commands

```bash
wrangler vpc service create umaxica-dev-rails-api --type http \
  --tunnel-id 03a4a67c-2aca-4f2c-9aeb-d1666f18bc87 \
  --hostname core-workers-vpc.internal --http-port 3000
wrangler vpc service get 01a06fd0-89b7-7613-9e1d-f7d07c693273
node tools/verify-edge-connectivity.mjs vpc
```

The API token in `.env` (`umaxica.com@gmail.com`) could not create the service: reads succeed but
`POST /accounts/…/connectivity/directory/services` returns `Authentication error [code: 10000]`, and
adding the `接続ディレクトリ` (Connectivity Directory) admin permission did not change it. Creation
required an OAuth session — `wrangler login` as `umaxica.com@gmail.com` on the UMAXICA account,
which carries `connectivity:admin`. Remote bindings need that session anyway, so the API token must
be unset when running these commands or wrangler prefers it and fails.

## Observations

`wrangler vpc service get 01a06fd0-…` returns type `http`, port `3000`, hostname
`core-workers-vpc.internal`, tunnel `03a4a67c-…`.

`node tools/verify-edge-connectivity.mjs vpc`:

- `Binding resolved: env.UMAXICA_APPS_EDGE_CF_WORKERS_VPC (01a06fd0-89b7-7613-9e1d-f7d07c693273)
VPC Service remote` — PASS
- `Direct VPC → Rails` PASS for all fifteen surfaces, Rails answering `200`
- `VPC identity` WARN for all fifteen: the health payload carries no namespace field. Pre-existing;
  identical on the old service before the migration.

Rails-side confirmation, in the Global container: 30 `/api/v0/health.json` requests logged (two runs
× fifteen surfaces), each dispatched to its own controller — e.g. `Info::Org::Api::V0::
HealthsController` for `ORG/INFO` — so Host-based namespace routing survived the migration. The
`Auth` connector is attached to a network with no Rails container, so it cannot have served these.

Global-side gates for the same path are in that repository's
`evidence/2026-09-05-workers-vpc-dedicated-tunnel.md`: `/health/` and `/revision` both `200` through
`core-workers-vpc.internal:3000`, and the connector registers four QUIC connections with UDP 7844
available.

## Checks

- `node tools/check-workers.mjs` — OK, 20 workers validated
- `pnpm exec vitest run --dir test test/rails-connection-invariants.test.ts` — 155 passed
- `pnpm run test` — 21 unit suites pass. The root suite has 5 failures and 3 unloadable suites, all
  pre-existing and untouched by this change: `tunnel-surface-identity` conflicts with the apex health
  API added in `272d0911`, and three compose suites abort on a missing `compose.override.yaml.example`.
- `pnpm run check:generated`, `knip`, `check:workers`, `check:architecture`, `check:deps` — OK
- `pnpm run format:check`, `lint`, `lint:types`, `typecheck`, `check:spelling` — FAIL, all
  pre-existing in files this change does not touch: format in `adr/014` and three `2026-09-04`
  evidence records, `require-unicode-regexp` in `app/apex` specs, jest-dom matcher typings in
  `*/core/test/ui-shell-contract.test.tsx`, and `umaxicaappsglobaldc` unknown to cspell in an
  evidence record.

## Not done

The old VPC Service `019f5fe0-…` and the `Auth` and `Edge` tunnels were left in place. Nothing in
either repository's configuration now references the old service, but deleting Cloudflare resources
for tidiness is outside this change.
