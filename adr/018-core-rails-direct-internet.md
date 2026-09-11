# ADR 018: The three Cores reach Rails over the public internet, not Workers VPC

## Status

Accepted — 2026-09-11. Supersedes ADR 005 and ADR 006 **for `{app,com,org}/core`
only**. The twelve Astro content surfaces keep the Workers VPC transport those
ADRs describe.

## Context

The TanStack Start Cores (`app/core`, `com/core`, `org/core`) reached Rails over
the Workers VPC binding `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`: browser dispatch of
Rails-owned paths in `src/lib/core-dispatch.ts`, and the Health API probe in
`src/lib/rails-client.ts`. The Rails API these Cores talk to is published on the
public internet, so the private hop is not needed for them.

The binding carried real costs for these three units: a `vpc` wrangler tier and a
`dev:vpc` script, a remote-binding session that needs an interactive
`wrangler login`, a separate `EDGE_LOCAL_*` transport for local development that
had to be bridged into workerd by `vite.config.ts`, and special handling for the
`ProxyError:` 500 that Workers VPC answers instead of throwing.

## Decision

1. Each Core reads its Rails origin from a `RAILS_ORIGIN` var in its own
   `wrangler.jsonc`, per tier. There is no Rails origin constant in code.
2. Both callers use the Worker's ordinary `fetch`. `vpc_services`, `env.vpc`,
   `dev:vpc`, the `EDGE_LOCAL_*` branch and the ProxyError handling are removed
   from the Cores.
3. `src/lib/rails-origin.ts` accepts only a bare `https` origin, or plain `http`
   for a `*.localhost` host. The browser's Cookie and Authorization headers ride
   the dispatch hop, so they must not cross the internet in cleartext. Anything
   else counts as not configured and fails closed: 503 on Rails-owned paths, and
   `not-configured` on `/health`.
4. No authentication header is added to requests to Rails.
5. Local development uses the same variable, set in the gitignored `.dev.vars`
   (`RAILS_ORIGIN=http://core.<brand>.localhost:3000`, the development
   container's Rails; `.dev.vars.example` carries the line). `env.local` itself
   names none: `pnpm test:api`, Playwright and CI run without Rails and wait for
   `/health` 2xx, which a configured but unreachable Rails turns into 503
   (measured 2026-09-11 against `vite dev`: no origin 200, an unreachable origin
   in `.dev.vars` or in `env.local` 503).
6. `env.test` names no Rails origin, and neither do production nor
   `env.development` until the public Rails hosts exist.

## Consequences

- Rails now receives `Host` = the `RAILS_ORIGIN` host, not `jp.umaxica.<brand>`.
  Under the VPC binding the request was built against the public Core hostname.
  Rails' Host Authorization and any absolute URLs it generates (redirects, OIDC
  callbacks, cookie domains) must accept the `RAILS_ORIGIN` host.
- Client-supplied `Forwarded` / `X-Forwarded-*` / `X-Real-IP` are still dropped.
  Rails therefore sees Cloudflare's egress address, not the browser's, as it did
  over VPC.
- The dispatch log outcomes `vpc_unreachable` and `binding_not_configured` became
  `upstream_unreachable` and `origin_not_configured`, and `proxy_error_code` is
  gone.
- Until `RAILS_ORIGIN` is set for production and `env.development`, every
  Rails-owned path on those tiers answers 503.
