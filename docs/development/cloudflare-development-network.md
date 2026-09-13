# Cloudflare development network

A missing Workers binding is never fabricated and never falls back to Access or another
environment.

Every deployment unit's dev server runs the Worker in workerd. One consequence is load-bearing here
and was found by measurement: **workerd's `process.env` is not the shell's**, so the Astro
surfaces' `EDGE_LOCAL_*` overlay flags are forwarded explicitly into the Worker, and only while
serving.

Paths 1–4 below are the twelve Astro content surfaces. The three Cores (`{app,com,org}/core`) hold
no Workers VPC binding: they reach Rails over the public internet with the Worker's own `fetch`, at
the per-tier `RAILS_ORIGIN` var (path 6; `adr/018-core-rails-direct-internet.md`).

```text
1. vite dev (workerd) ── private rootless Podman network ── Rails development

2. check-tunnel ── HTTPS + Access service token ── Cloudflare Access
                                                    └─ Tunnel (Rails-owned) ── Rails

3. local workerd ── remote:true VPC binding ── development VPC Service
                                               └─ Tunnel ── Rails

4. production Worker ── production VPC binding (currently absent: fail closed)

5. browser ── Cloudflare Access ── Edge-owned Tunnel ── Edge compose default network
                                                          └─ Edge dev server (vite dev, workerd)

6. Core Worker (vite dev or deployed) ── fetch() ── RAILS_ORIGIN ── Rails
   (no tier names one yet, so fail closed; locally opt in via .dev.vars:
    RAILS_ORIGIN=http://core.<brand>.localhost:3000)
```

Path 5 is inbound and browser-facing; paths 2–4 are outbound, server-to-server. The Edge Tunnel and
Global/Rails Tunnel are independent. A Tunnel route on path 5 does not give the local process a Workers
runtime or a Workers binding — that is what paths 3 and 4 are for.

| Path            | Caller/runtime                                      | Destination                                               | Authentication/product                                 | Failure behavior                                                                                                            | Validation                                         | Status after repository implementation        |
| --------------- | --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Private Rails   | `vite dev`, local workerd                           | `<frame>.<brand>.localhost:3000` on `EDGE_RAILS_NETWORK`  | Rootless Podman network; no Access credential          | Missing overlay returns `not-configured`; unreachable network reports failure                                               | `scripts/check-rails`, `pnpm run check:local`      | Runtime verification required                 |
| Access/Tunnel   | `scripts/check-tunnel`                              | `EDGE_TUNNEL_RAILS_URL`                                   | Dedicated Access service token; Rails-owned Tunnel     | Missing token is `BLOCKED`; Access/Tunnel/backend failures stay distinct                                                    | `scripts/check-tunnel`                             | Credential verification required              |
| Development VPC | local workerd: `pnpm preview`, `preview:vpc`, probe | configured development VPC Service, then Rails            | Interactive `wrangler login`; an API token is rejected | Without a session `preview` aborts; `vite dev` passes `remoteBindings: false` outside the `vpc` tier, so it never opens one | `scripts/check-vpc`, `pnpm run check:preview:vpc`  | Blocked: no OAuth session in this environment |
| Production VPC  | deployed production Worker                          | **bootstrap: the development VPC Service**, then Rails    | Workers runtime binding, no `remote`                   | Binding present; a stopped local Rails/tunnel makes production report 503                                                   | static binding invariants; `pnpm run check:config` | Bootstrap — AWS cutover pending               |
| Core → Rails    | the three Cores, any tier                           | `RAILS_ORIGIN` (https; plain http only for `*.localhost`) | None — ordinary `fetch` over the public internet       | No `RAILS_ORIGIN` answers 503 on Rails-owned paths and `not-configured` on `/health`                                        | `test/rails-connection-invariants.test.ts`         | No tier names one yet; locally, `.dev.vars`   |

The URL host passed to Workers VPC supplies Host/SNI semantics; the VPC Service determines
routing. Tests pin each frame host and the shared development service ID.

Production deliberately shares that development service **for now**. AWS production Rails does not
exist, and pointing the deployed Worker at the one service that does is the only way to exercise the
real edge → Workers VPC → VPC Service → Tunnel → Rails path before it does. The cost is stated
plainly: production Rails connectivity is only as available as the developer machine behind the
tunnel. `tools/workers-manifest.json` holds the two ids as separate fields so the AWS cutover is a
change to `vpcProductionServiceId` and the twelve Astro surfaces' top-level `service_id`s, with no application
change. See ADR 006.

| Edge dev exposure | browser | sixteen published FQDNs, then `core:<port>` | Cloudflare Access on all sixteen, whole host, no `/health*` Bypass | Container or dev server down returns 502, reported BLOCKED not FAIL; unauthenticated is 302 to the team domain | `pnpm run check:tunnel:edge` | Runtime verification required after the Tunnel split |

The Edge repository runs its own `cloudflared` sidecar with a dedicated token and owns its Tunnel
lifecycle. It shares no Podman network with Global — see
[`docs/operations/cloudflare-tunnel-development.md`](../operations/cloudflare-tunnel-development.md)
and `adr/014-edge-owned-development-tunnel.md`.
External Cloudflare dashboard/API changes are outside this refresh and must be documented and
authorized separately.
