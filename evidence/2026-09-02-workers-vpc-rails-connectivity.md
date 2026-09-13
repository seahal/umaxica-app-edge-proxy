# Workers VPC → Rails connectivity after the Astro migration

## What was being verified

That a request originating in an Edge Worker still reaches Rails over the Workers VPC binding
`UMAXICA_APPS_EDGE_CF_WORKERS_VPC`, and that each of the fifteen Rails-backed frames reaches **its
own** Rails namespace rather than another frame's, given that one VPC Service carries all fifteen
and only the `Host` header separates them.

## Why

The twelve public content surfaces were migrated to Astro today (ADR 015), promoting `src-astro/`
to `src/` and rewriting the transport helpers (`src/lib/rails-client.ts`, `src/lib/rails-health.ts`,
`src/lib/env.ts`). ADR 006 last recorded this path verified end to end on 2026-08-10. The path had
since stopped working, and it needed to be re-established and re-measured rather than assumed.

## Context

- Repository: `umaxica-apps-edge`
- Revision at time of check: `f5343777` (feature)
- Host: Linux, node v24.20.0, pnpm 12.0.0, wrangler 4.127.1
- Cloudflare auth: OAuth token (account `UMAXICA`). An API token cannot open a remote-binding
  session at all, which is why OAuth is a precondition and not a preference.
- VPC Service: `019f5fe0-287f-7040-9f2f-036cb5b21df7` (`umaxica-apps-edge-cf-workers-vpc`),
  tunnel `1d501e9a-62f7-4c0d-ba5e-a26e3f10088f`, HTTP:3000
- Rails revision answering: `926a2e5965782b4e6af6fdcf49580f515521c895`
- Date: 2026-09-02

## Result

**PASS.** All fifteen frames were observed answering `200` over the VPC binding with their own
namespace. Every request was issued by `tools/vpc-probe/`, a Worker that imports no application
code and has no `fetch()` fallback, so a green result cannot be produced by anything but the
binding.

| Brand | Namespaces observed                                    |
| ----- | ------------------------------------------------------ |
| app   | `core/app` `docs/app` `help/app` `info/app` `news/app` |
| com   | `core/com` `docs/com` `help/com` `info/com` `news/com` |
| org   | `core/org` `docs/org` `help/org` `info/org` `news/org` |

This settles the open question ADR 006 raised on 2026-08-10: cloudflared forwards the original
`Host` header intact, so fifteen frames sharing one VPC Service do land in fifteen distinct Rails
namespaces. Host passthrough is not assumed here; it is what the namespace column measures.

## Commands run and what was observed

| Command                                                                    | Observed                                                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm exec wrangler whoami --env-file tools/vpc-probe/empty.env`           | OAuth Token, account `UMAXICA`, scope `connectivity (admin)`                                                |
| `pnpm exec wrangler vpc service list --env-file tools/vpc-probe/empty.env` | `019f5fe0-…` present, tunnel healthy                                                                        |
| `CLOUDFLARE_API_TOKEN= node tools/verify-edge-connectivity.mjs config`     | 15/15 PASS on Toolchain, VPC config, Rails routing                                                          |
| `CLOUDFLARE_API_TOKEN= node tools/verify-edge-connectivity.mjs vpc`        | binding resolved as VPC Service, remote; per-frame namespaces as tabled above (three runs, see Limitations) |

A representative Rails liveness document returned over the binding:

```json
{
  "status": "ok",
  "check": "liveness",
  "namespace": "help/com",
  "dependencies": {},
  "details": { "generated_at": "2026-09-02T14:22:0…", "revision": "926a2e59…" }
}
```

`CLOUDFLARE_API_TOKEN` must be blanked rather than unset: it is set in the repository's root `.env`
(line 36), which wrangler reloads on every invocation, and an API token takes precedence over the
OAuth session.

## What was broken, and what fixed it

Four independent faults were stacked on this path. Each was diagnosed and cleared in turn; none was
caused by the Astro migration.

1. **API-token-only authentication.** `wrangler login` refused to start OAuth while
   `CLOUDFLARE_API_TOKEN` was present. It is in the root `.env`, not the shell environment, so
   `env -u` does not clear it. Resolved by `wrangler login --env-file tools/vpc-probe/empty.env`.
2. **Cloudflare Access over `*.workers.dev`.** `wrangler dev --remote` serves the binding through a
   proxy Worker at `<name>-development.umaxica.workers.dev`. An Access application covering that
   subdomain answered `302` to `https://umaxica.cloudflareaccess.com/cdn-cgi/access/login/…` before
   the request reached the VPC Service. Confirmed by the Access JWT `meta` claim, whose `hostname`
   was the probe Worker's own workers.dev name, and by a control request to a non-existent host
   returning the identical `302` — a request that reached the VPC Service would have been routed by
   `service_id` regardless of host. Resolved account-side.
3. **Tunnel connector and Rails both stopped.** `dial tcp 10.89.2.2:3000: connect: connection
refused`. Resolved by restarting both.
4. **`.localhost` in the VPC Service host.** This was the substantive regression. The Service's host
   was `core.app.localhost`. On the VPC path, name resolution happens **Cloudflare-side** and the
   connector receives an already-resolved `destAddr` (tunnel log: `originService=warp-routing`,
   `destAddr=[::1]:3000` and `127.0.0.1:3000`, `type=tcp`). RFC 6761 reserves `.localhost` to
   loopback, so the connector was dialling itself. The public-hostname path is unaffected because it
   matches an ingress rule and cloudflared resolves the origin name itself through the container DNS
   (`aardvark-dns`), which answers `10.89.2.2` — the same name, resolved by a different resolver on a
   different path. Resolved by setting the VPC Service host to the literal address `10.89.2.2`.

An intermediate attempt set the host to the single label `internal`, which also failed: `.internal`
is reserved for private use but provides no resolution of its own, and Cloudflare-side resolution
has no view of the container network.

## Limitations

**The fifteen namespaces were not all observed in a single run.** Roughly a third of requests return
`500` with the body `error code: 1101`, intermittently and with no fixed set of affected frames —
`APP/CORE` failed in one run and passed in the next. Six sequential requests to one target
(`help.com.localhost`) returned `500, 500, 200, 200, 500, 500`. The `1101` responses carry
`content-type: text/plain` and originate at Cloudflare, not at Rails: whenever Rails answered, it
answered `200` with the correct namespace. The union of three `check:vpc` runs plus that repeated
single-target probe covers all fifteen frames. Connectivity and `Host` passthrough are therefore
established; **per-run reliability of the remote-binding proxy is not**, and a clean 15/15 run was
not obtained.

`error code: 1101` is not classified correctly by `*/src/lib/rails-client.ts`. That module maps a
`500` whose body matches `/^ProxyError:\s*\w+/` to `kind: 'unreachable'`; `error code: 1101` does not
match, so an unreachable upstream is reported as `http-error`. Not changed here.

`tools/verify-edge-connectivity.mjs` reports any non-200 as "transport reached Rails, which answered
N". During this investigation it labelled the Access `302` that way, which is the opposite of what
had happened — the request had not reached Rails, or the tunnel, or the VPC Service. The `302` was
identifiable only from its body (`<hr><center>cloudflare</center>`) and its `Location`. Not changed
here.

The three configuration faults above were fixed in the Cloudflare dashboard. Nothing in the
repository was changed to obtain this result; `service_id` was already correct in all fifteen
`wrangler.jsonc` files and `check:config` passed 15/15 before any of it. The `check:vpc` and
`check:preview:vpc` paths remain gated on an OAuth session, so this check cannot run in CI as
configured.

Production connectivity remains unverified: production still points at the development VPC Service
by design (ADR 006 Phase 1), so what is measured here is bounded by one developer's machine.
