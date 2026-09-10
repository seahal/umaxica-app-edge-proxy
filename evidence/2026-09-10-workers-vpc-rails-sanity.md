# Workers VPC → Rails sanity check

## What was being verified

That a request originating in an Edge Worker reaches Rails over the Workers VPC
binding `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`, and that each of the fifteen
Rails-backed frames reaches **its own** namespace.

## Result

**PASS.** All fifteen frames answered `200` over the binding with the matching
namespace. The probe is `tools/vpc-probe/` (no application `fetch()` fallback).

| Brand | Namespaces observed                                    |
| ----- | ------------------------------------------------------ |
| app   | `core/app` `docs/app` `help/app` `info/app` `news/app` |
| com   | `core/com` `docs/com` `help/com` `info/com` `news/com` |
| org   | `core/org` `docs/org` `help/org` `info/org` `news/org` |

Binding resolved as VPC Service `01a06fd0-89b7-7613-9e1d-f7d07c693273`
(`umaxica-dev-rails-api`), host `core-workers-vpc.internal`, HTTP:3000, tunnel
`03a4a67c…`, `remote`. Contract check: `status=pass`, required fields present
on all fifteen.

## Commands

| Command | Observed |
| ------- | -------- |
| `CLOUDFLARE_API_TOKEN= pnpm exec wrangler whoami --env-file tools/vpc-probe/empty.env` | OAuth Token, account `UMAXICA`, scope includes `connectivity (admin)` |
| `CLOUDFLARE_API_TOKEN= pnpm exec wrangler vpc service list --env-file tools/vpc-probe/empty.env` | `01a06fd0-…` (`umaxica-dev-rails-api`) and `019f5fe0-…` (`umaxica-apps-edge-cf-workers-vpc`) listed |
| `CLOUDFLARE_API_TOKEN= node tools/verify-edge-connectivity.mjs vpc` | 15/15 PASS on Direct VPC → Rails, VPC identity, VPC contract; exit 0 |

First pass in this session was **BLOCKED** (no OAuth). After `wrangler login`
the same command produced the table above.

## Limitations

This measures the **development** VPC Service. Production `wrangler.jsonc`
still shares that same `service_id` (bootstrap warning from `check:config`).
Local `127.0.0.1:3000` is not required for this probe; routing is Cloudflare-side
through the VPC Service and tunnel.
