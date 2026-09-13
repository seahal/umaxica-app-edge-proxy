# Plan 006: A development transport over the Workers VPC binding

## Status: Implemented and verified end to end

> **AMENDED 2026-09-05 — the resource identifiers below are historical.** The
> account no longer holds "exactly one VPC Service", and the one named
> throughout this record has been retired from configuration:
>
> |             | Recorded here                                              | Since 2026-09-05                                                              |
> | :---------- | :--------------------------------------------------------- | :---------------------------------------------------------------------------- |
> | VPC Service | `019f5fe0-…` `umaxica-apps-edge-cf-workers-vpc`            | `01a06fd0-89b7-7613-9e1d-f7d07c693273` `umaxica-dev-rails-api`                |
> | Tunnel      | `1d501e9a-…` (`Auth`, shared with the published hostnames) | `03a4a67c-2aca-4f2c-9aeb-d1666f18bc87` (`umaxica-dev-workers-vpc`, dedicated) |
> | Target host | `core.app.localhost` HTTP:3000                             | `core-workers-vpc.internal` HTTP:3000                                         |
>
> Two corrections matter beyond the identifiers. First, this record states the
> service terminated on `core.app.localhost`; it did not. `wrangler vpc service
get` reported the raw Podman address `10.89.2.2`, because RFC 6761 makes glibc
> resolve any name under `localhost.` to loopback before a container resolver is
> consulted, so no `*.localhost` alias can serve as a VPC Service target. Second,
> binding the service to the `Auth` tunnel coupled this transport to the tunnel
> that also serves the ten Access-protected browser hostnames.
>
> The decisions in this record are unchanged: the binding name, its placement
> across environments, the `remote: true` requirement, and the credential cost
> all still hold. Only the backing resources moved, exactly as the "AWS cutover"
> paragraph anticipated — `tools/workers-manifest.json` remains the single source
> of the id. See `evidence/2026-09-05-workers-vpc-dedicated-tunnel.md` and the
> Global repository's `docs/operations/cloudflare-private-origin.md`.

## Amends

[ADR 005](005-rails-edge-workers-vpc-connection.md). That record stands except
for two things: decision 1's development half together with its placement of the
binding, and **decision 3, which is retracted outright** — Rails does not route
on a `/{frame}/{brand}` prefix. Decisions 2, 4, 5, 6 and 7 are unchanged and are
not restated here.

## Problem

ADR 005 gave development a different transport from production:

| Env           | Transport                                    |
| ------------- | -------------------------------------------- |
| `production`  | Workers VPC binding                          |
| `development` | HTTPS to an Access-protected public hostname |

The two paths share only their last hop. Everything specific to the production
path — that the binding exists, that its `service_id` is right, that the VPC
Service points at the intended host and port, how a Worker behaves when the
tunnel is down — was unobservable until a deploy. ADR 005 recorded that
production had never in fact been exercised: "**Not verified end to end.**"

Two things then turned out to be wrong.

### 1. Development _can_ use the binding

ADR 005 argued:

> A VPC binding is a Workers-runtime facility; locally the Edge is a Node
> process in a container, so there is no runtime to grant it.

This is not correct.

- `opennextjs-cloudflare preview` runs the application in local **workerd** —
  the Workers runtime, on your machine.
- `remote: true` does not upload the Worker. It runs the code locally and
  proxies **only the binding** out to the real Cloudflare resource, over a
  remote-proxy pair that wrangler stands up.
  ([architecture](https://blog.cloudflare.com/connecting-to-production-the-architecture-of-remote-bindings/))
- Cloudflare documents this as _the_ way to reach a VPC Service in local
  development: "`remote: true` … allows access to the VPC Service during local
  development."
  ([VPC Services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/))
- `*/next.config.ts` already calls `initOpenNextCloudflareForDev()`, and
  `compose.yaml` already carried a comment observing that this authenticates to
  Cloudflare on start-up — the mechanism was known here before it was argued
  away.

What ADR 005 got right is that there is a **cost**, though it turned out to be a
different and sharper one than "a write-scoped API token". Measurement (see
Outcome) showed a remote-binding session cannot be opened with an API token at
all — `edge-preview` rejects that authentication scheme — so `preview:vpc`
requires an interactive `wrangler login` per developer.

That is a real reason to keep the binding off the default development loop. It
is not a reason to have no local VPC path at all.

### 2. `env.production` pointed at a development resource

The account holds exactly one VPC Service:

```
id      019f5fe0-287f-7040-9f2f-036cb5b21df7
name    umaxica-apps-edge-cf-workers-vpc
host    core.app.localhost   HTTP:3000
tunnel  1d501e9a-62f7-4c0d-ba5e-a26e3f10088f
```

Tunnel `1d501e9a-…` is the development tunnel, whose connector runs beside a
local Rails container. All fifteen `env.production` blocks named this service.

So the misconnection ADR 005 set out to prevent already existed, pointing the
other way: a deployed production Worker would have left the production network
and arrived at a developer's machine. It had never fired only because
production had never been exercised.

## Decision

### 1. The binding lives in one environment, and nowhere else

> **SUPERSEDED 2026-08-16.** The binding now lives at the top level (production)
> and in `env.development` as well as `env.vpc`. See the Phase 2 amendment below,
> including the measurement that shows the credential cost this decision tried to
> confine cannot be confined.

> Renamed `preview` → `vpc` on 2026-08-09; see the amendment above. The
> reasoning below is unchanged.

A fourth wrangler environment carries it:

```jsonc
"preview": {
  "vars": { "CLOUDFLARE_ENV": "preview", "NODE_ENV": "development", ... },
  "vpc_services": [
    {
      "binding": "UMAXICA_APPS_EDGE_CF_WORKERS_VPC",
      "service_id": "019f5fe0-287f-7040-9f2f-036cb5b21df7",
      "remote": true
    }
  ],
  ...
}
```

Bindings are **not inherited** into `env.*`
([Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)),
so this placement is structural rather than procedural: no other environment can
acquire the binding by accident, and a development command's configuration never
names a production resource.

This was preferred to a flag (`--local` / `--remote`) on a shared environment.
A flag leaves the other environment's `service_id` textually reachable from the
development command, and reduces the separation to remembering to pass it.

### 2. Production carries no binding, and fails closed

> **SUPERSEDED 2026-08-16.** Production now declares a real VPC binding, pointed
> at the development Service during the AWS bootstrap. See the Phase 1 amendment
> below; the text here is kept as the record of what was decided and why it was
> reversed.

> Production moved out of `env` to the top level on 2026-08-09; see the
> amendment above. "env.production" below now means the top level.

Production has no Rails transport until a production VPC Service on a production
tunnel exists. Neither exists today. `getRailsClient()` therefore returns `null`
in production and `/rails-health` reports `not-configured` and answers 503.

This removes no working capability — the production path had never carried a
request — and it removes the routing of production traffic to a developer's
machine. The absence is visible rather than silent, which is the point.

Restoring it is two steps, both outside this repository first:

1. Create a production tunnel beside production Rails, and a production VPC
   Service on it. **Dashboard/API action.**
2. Add the `vpc_services` block back at each frame's top level with that
   `service_id`.

`tools/check-workers.mjs` and `test/rails-connection-invariants.test.ts` both
fail if that restoration reuses the development `service_id`.

### 3. Three development tiers

| Command            | Runtime                            | VPC binding     | Cloudflare credential    |
| ------------------ | ---------------------------------- | --------------- | ------------------------ |
| `pnpm dev`         | Node (`next dev`)                  | no              | **none**                 |
| `pnpm preview`     | local workerd, `--env development` | no              | **none**                 |
| `pnpm preview:vpc` | local workerd, `--env vpc`         | **yes, remote** | `wrangler login` (OAuth) |
| `pnpm deploy`      | Cloudflare, no `--env` (top level) | none, for now   | API token                |

Note the credentials differ in kind, not just in scope: deploys use the API
token, `preview:vpc` cannot (see Outcome). Run it with the token blanked so the
`.env` copy does not leak back in:

```bash
CLOUDFLARE_API_TOKEN= pnpm --filter umaxica-apps-edge-app-docs run preview:vpc
```

The credential cost falls only on the third, which is named for what it opts
into. ADR 005's best property — that ordinary local development needs no
Cloudflare account — is preserved exactly.

There is deliberately **no root-level `preview:vpc` fan-out**. Fifteen
concurrent preview servers would each open their own remote-proxy session
against Cloudflare. Run it one workspace at a time:

```bash
pnpm --filter umaxica-apps-edge-app-docs run preview:vpc
```

### 4. No path prefix — ADR 005 decision 3 is retracted

ADR 005 decision 3 had each frame prepend `/{frame}/{brand}` to every Rails
request, so that fifteen frames sharing one VPC service and one Host could still
be told apart. It flagged its own uncertainty:

> Whether Rails needs that at all depends on how it distinguishes brands — by
> `Host`, or by the `/{frame}/{brand}` path prefix it already receives. That is
> a question for the Rails repository and is **not settled here**.

The first real request settled it:

```
ActionController::RoutingError (No route matches [GET] "/docs/app/health/liveness.json")
```

Rails serves `/health/liveness.json` and routes on the path exactly as given.
`RAILS_FRAME_PREFIX` is removed from all fifteen copies, along with the
`pathPrefix` parameter of `createRailsClient` — a parameter nobody passes reads
as one somebody should.

Frames are consequently **not distinguished at the URL level at all**. If Rails
later needs to know which frame is calling, that will be a deliberate addition
(a header, most likely) rather than a revival of this.

`test/rails-connection-invariants.test.ts` guards the retraction, because the
failure mode is quiet: a prefix reintroduced produces 404s, `checkRailsHealth`
maps those to `http-error`, and `http-error` reads like a Rails outage rather
than a client bug. That is exactly how this one stayed invisible.

### 5. `getRailsClient()` is unchanged

ADR 005 decision 5 resolves the transport by **which configuration exists**,
with no branch on the environment name. `env.vpc` supplies a binding, so
branch 1 fires there exactly as it was meant to in production. No application
code changed in this record — which is the evidence that decision 5 was right.

### 6. No connector, and no shared Podman network, in this repository

The path is:

```
local workerd → Cloudflare → VPC Service → tunnel → connector → Rails
```

The connector must sit where it can reach **Rails**, and it does — in the Rails
Compose project. A connector here could not reach Rails (different project, no
shared network), and adding one would register a _second_ connector on the
development tunnel. Cloudflare load-balances across connectors, so roughly half
of all development VPC requests would land on a connector that cannot serve
Rails and fail intermittently. `test/compose-tunnel-invariants.test.ts` keeps
that from being added, and stays as it is.

The Edge container never resolves or dials Rails, so no shared network is
needed. This is unchanged from ADR 005 and from
`docs/operations/cloudflare-tunnel-development.md`.

### 7. Cloudflare Access is not part of this path

Workers VPC reaches a private origin through the tunnel; the trust boundary is
the VPC Service plus the tunnel, with no shared secret. Cloudflare's Workers VPC
documentation involves no Access application or service token
([get started](https://developers.cloudflare.com/workers-vpc/get-started/)).

Access belongs at **browser → Edge** ingress. Workers VPC is **Edge → private
origin** egress. Neither substitutes for the other.

ADR 005's Access transport (branch 2 of `getRailsClient()`) is retained as a
fallback for a developer without a Cloudflare credential, but note that it
currently points at `core-jp.umaxica.app`, which fronts the **same** tunnel —
it is not an independent path, and it is not the recommended one.

## Production parity

Identical: the Workers runtime, `compatibility_date`/`compatibility_flags`, the
OpenNext build output, the binding shape, the `env.<BINDING>.fetch()` call path,
the VPC-service → tunnel → Rails hops, `RAILS_VPC_ORIGIN`, `RAILS_FRAME_PREFIX`,
the 5 s timeout, the header stripping, and the transport-resolution order.

Different, and this is the honest cost:

| Aspect                                   | `preview:vpc`                              | Production                         |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------- |
| Where the binding call originates        | your machine, via the remote-binding proxy | Cloudflare's edge                  |
| Extra hops / latency                     | machine → Cloudflare → tunnel              | edge → tunnel                      |
| Auth for the binding                     | your credential gates the proxy session    | none — the Worker owns the binding |
| Smart placement, real rate limiting, ISR | not exercised                              | exercised                          |
| Rails                                    | local container                            | AWS                                |

Full parity is not achievable and is not claimed. What this buys is the class of
failure the Access transport structurally could not surface: a missing or wrong
binding, a VPC Service aimed at the wrong host or port, a tunnel that is down,
and workerd-versus-Node differences in the request path.

## Environment separation

| Item                | development (`preview`) | production              |
| ------------------- | ----------------------- | ----------------------- |
| Tunnel              | `1d501e9a-…`            | does not exist yet      |
| VPC Service         | `019f5fe0-…`            | does not exist yet      |
| Binding declaration | `env.vpc` only          | none (top level)        |
| Worker              | never deployed          | `umaxica-apps-edge-*-*` |
| Rails               | local Podman            | AWS                     |
| Cloudflare account  | shared — deliberate     | shared                  |

Sharing one account is a deliberate trade: a second account would harden the
boundary but double the administration, and the `service_id` assertions already
make the misconnection fail the build rather than fail in production.

## Guardrails

- `tools/check-workers.mjs` — the binding is declared exactly once, in
  `env.vpc`, with `remote: true` and the `service_id` recorded in
  `tools/workers-manifest.json`; absent from `development`, `test`,
  `production`, and the top level.
- `test/rails-connection-invariants.test.ts` — the same rules textually, plus
  fifteen-frame agreement on the `service_id`, plus **production must never
  reuse the development `service_id`**. That last one holds vacuously today and
  starts biting the moment production is restored, which is when it is needed.
- `test/compose-tunnel-invariants.test.ts` — unchanged; still rejects a
  connector, a `compose.custom.yaml`, or a tunnel token in this repository.

## Outcome

**Implemented.** Changed:

- `*/wrangler.jsonc` (×15) — added `env.preview` with the binding and its own
  rate-limit namespace (`400{1,2,3}`); removed `vpc_services` from
  `env.production`, leaving a comment explaining the absence.
- `*/package.json` (×15) — added `preview:vpc`.
- `*/cloudflare-env.d.ts` (×15) — regenerated; `CLOUDFLARE_ENV` gains
  `'preview'` and a `Cloudflare.PreviewEnv` appears.
- `tools/workers-manifest.json`, `tools/check-workers.mjs`,
  `test/rails-connection-invariants.test.ts` — as above.
- `compose.yaml` — two comments corrected; they described a `cloudflare-tunnel`
  service in a `compose.custom.yaml` that this repository forbids, and claimed
  `pnpm dev` authenticates to Cloudflare.

No application code changed: no `src/lib/rails-client.ts`, no
`src/lib/rails-health.ts`, no `*/apex`, no Compose service, no network.

**Verified end to end, 2026-08-08** — the first time a request from this
repository has reached Rails, over any transport.

```
$ CLOUDFLARE_API_TOKEN= pnpm --filter umaxica-apps-edge-app-docs run preview:vpc
env.UMAXICA_APPS_EDGE_CF_WORKERS_VPC (019f5fe0-…)   VPC Service   remote
Ready on http://localhost:8787

$ curl -s 127.0.0.1:8787/rails-health
HTTP 503  {"rails":{"kind":"http-error","status":404}}
```

and, in the Rails log on the other side of the tunnel:

```
ActionController::RoutingError (No route matches [GET] "/docs/app/health/liveness.json")
```

`http-error` means Rails answered. The Rails-side log entry is stronger evidence
than the `ok`→`unreachable` comparison originally planned, so that step was
dropped: a routing error recorded at the destination proves arrival directly,
where the comparison only proved departure.

The 404 is a **Rails routing question, not a transport one** — see ADR 005
decision 3, which explicitly left open whether Rails distinguishes frames by
`Host` or by the `/{frame}/{brand}` prefix. That question is now the only thing
between here and a green `/rails-health`.

### Amendment, 2026-08-10 — fifteen Rails entry points, still one VPC Service

The staged single-host period is over. Each frame now addresses its own Rails
namespace, and **no Cloudflare resource was added to do it**: the VPC Service,
its `service_id` and the tunnel are unchanged.

The mechanism is the `Host` header alone. Measured through one Service before
changing anything:

```
core.app.localhost  →  Core::App::Health::LivenessesController
core.com.localhost  →  Core::Com::…          docs.app.localhost  →  Docs::App::…
core.org.localhost  →  Core::Org::…          news.app.localhost  →  News::App::…
```

Rails' namespace is `<Frame>::<Brand>::`, and the host is `<frame>.<brand>.localhost`,
so the fifteen frames map one-to-one onto fifteen entry points. Verified end to
end afterwards: a full `check:preview:vpc` produced exactly fifteen Rails
requests landing on fifteen distinct namespaces, in order.

Two consequences worth stating plainly:

- **A wrong host does not fail.** It reaches a different namespace and answers 200. So the mapping is pinned in two places — `Rails routing` in
  `check:config` (no longer opt-in; `STRICT_BRAND_ROUTING` is gone) and
  per-frame assertions in `test/rails-connection-invariants.test.ts`. The old
  invariant asserted all fifteen origins were _identical_, which was only ever a
  record of the staging.
- `PRIVATE_CORE_RAILS_ORIGIN` is now `PRIVATE_RAILS_ORIGIN`. The `CORE` was
  false in the twelve content frames the moment they stopped pointing at
  `core.*`.

Splitting further — one VPC Service per brand, or per frame — remains available
and now needs no application change at all, since the hosts are already
distinct. It would be a Cloudflare-side change plus a `service_id` per
`env.vpc`. That is deliberately not done: one Service and one tunnel are
sufficient, and each extra one is a resource to provision, secure and keep in
step.

### Amendment, 2026-08-09 (b) — `env.preview` is now `env.vpc`, and production left `env` entirely

Two naming/structure corrections. Decision 1's _substance_ stands — the binding
still lives in exactly one environment, and ordinary local development still
needs no Cloudflare account. Only the shape changed.

**1. `env.preview` → `env.vpc`.** "Preview" is already an official Cloudflare
term: [Preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)
are the versioned URLs of a **deployed** Worker. This environment is never
deployed, so the name meant close to the opposite of what it named — and it
misled a reader in practice before it was changed. `vpc` says what distinguishes
it: it is the one environment carrying the VPC binding.

**2. There is no `env.production`; the top level is production.** A wrangler
environment deploys to a separate Worker named `<name>-<env>`, so
`env.production` had to re-declare `name` purely to cancel that out — fighting
the tool to stand still. Cloudflare's model is that the top level is the real
Worker and environments are its variants, so `wrangler deploy` with no `--env`
is now the production deploy. **The deployed Worker name does not change**
(`env.production.name` already equalled the top-level name), so nothing is
orphaned. This was also applied to the four `*/apex` workers, for one shape
across the repo.

**The hazard this creates, and the guard for it.** With no `--env`, the
`CLOUDFLARE_ENV` variable selects the environment — and `compose.yaml` exports
`CLOUDFLARE_ENV=development`. Measured with `wrangler deploy --dry-run`:

```
CLOUDFLARE_ENV=development, no --env   →  env.CLOUDFLARE_ENV ("development")
CLOUDFLARE_ENV=,            no --env   →  env.CLOUDFLARE_ENV ("production")
```

So a deploy from inside the container would have shipped to
`<name>-development` and left production untouched — a failure that looks like
success. Every deploy/build/typegen script therefore blanks it
(`CLOUDFLARE_ENV= opennextjs-cloudflare deploy`), and `tools/check-workers.mjs`
fails the build if a wrangler invocation has neither `--env` nor that blanking.

**One thing this record previously asserted is wrong.** `check-workers.mjs` used
to justify banning a top-level `vpc_services` with "it applies to every
environment, including development". It does not. Non-inheritable keys declared
at the top level do not reach `env.*` at all — measured:

```
▲ WARNING  "vars" is not inherited by environments.
No bindings found.        ← env.development resolved with nothing
```

The real reason to keep the binding out of the top level is simply that the top
level is now production, and the only VPC Service that exists is on the
development tunnel.

Verified after the change: `pn run check:preview:vpc` → `rails-health: ok` on
all fifteen frames; `pn run check:vpc` → 15/15; `pn run check:local` → all
green; 1185 tests pass.

### Amendment, 2026-08-09 — now a 200, and now a repeatable check

Two things have changed since the run recorded above.

**1. Rails answers 200.** The 404 was the open Rails-side routing question, and
it is resolved. Verified from `tools/vpc-probe/` — a Worker that binds only the
VPC service and imports no application code, so no fallback is possible:

```
env.UMAXICA_APPS_EDGE_CF_WORKERS_VPC (019f5fe0-…)   VPC Service   remote
{"probe":"reached","status":200,"contentType":"application/json; charset=utf-8",
 "body":"{\"status\":\"ok\",\"check\":\"liveness\", …,\"revision\":\"ff1d9f8d…\"}"}
```

and on the far side of the tunnel:

```
Processing by Core::App::Health::LivenessesController#show as JSON
Completed 200 OK in 2ms
```

Note `Core::App::` — **Rails selects the entry point from the `Host` header.**
The Workers VPC documentation states that the host in `env.<BINDING>.fetch(url)`
does not route the request (routing comes wholly from the VPC Service record) and
only populates `Host`, while the port is ignored outright.

**The staging ended the next day; see the amendment below.**

**2. A fourth thing the documentation had wrong.** Item 2 below says to blank
`CLOUDFLARE_API_TOKEN` rather than unset it, because `next build` reloads the
root `.env`. Under `wrangler dev` that is necessary but **not sufficient**:
wrangler loads the repo-root `.env` itself and re-injects the token, and the
session dies with `remote session could not be authenticated … authenticating via
a custom API token` even though the variable was blanked. The fix is
`--env-file <an empty file>`; `tools/vpc-probe/empty.env` exists for exactly
this and explains itself. `CLOUDFLARE_ENV` must also be cleared, since the
container exports it.

**Regression check.** This record is no longer the only evidence. Rerun it with

```bash
pn run check:vpc            # the raw binding transport
pn run check:connectivity   # config, vpc, next dev, preview, preview:vpc
```

See `docs/operations/connectivity-acceptance.md`.

### Three things the documentation had wrong, corrected here

1. **An API token cannot open a remote-binding session.** `POST
/accounts/<id>/workers/subdomain/edge-preview` returns `10405 Method not
allowed for this authentication scheme`; no scope changes it. `preview:vpc`
   requires `wrangler login`. `compose.yaml` previously asserted the opposite
   ("a scoped API token … is the supported path here").
2. **`CLOUDFLARE_API_TOKEN` must be blanked, not unset.** `next build` loads the
   repo-root `.env` into `process.env` and the wrangler child inherits it, so
   `env -u` is worse than useless — an absent key is what dotenv fills in.
   Symptom: the first remote connection succeeds, a second fails citing the
   token.
3. **`preview` serves on 8787**, not the frame's dev port; it passes no
   `--port`.

Also worth recording: wrangler's OAuth callback listener binds `::1` only, so an
IPv4 port forward never reaches it. Procedure for logging in from inside a
container is in `docs/operations/cloudflare-tunnel-development.md`.

### Amendment, 2026-08-16 (Phase 1) — production gets a real VPC binding, pointed at the development Service

**Decision 2 above is superseded.** It said production carries no binding and
fails closed. That was the right call while the alternative was an unexercised
guess; it is the wrong one now, because it makes the deployed path permanently
unobservable. Nothing about production — that the binding resolves at all, that
a Worker on Cloudflare's edge can open a VPC connection, that the VPC Service
answers from an edge invocation rather than from a remote-binding proxy — can be
learned by keeping the binding absent until AWS exists.

So the top level (which IS production) now declares:

```jsonc
"vpc_services": [
  {
    "binding": "UMAXICA_APPS_EDGE_CF_WORKERS_VPC",
    "service_id": "019f5fe0-287f-7040-9f2f-036cb5b21df7"
  }
]
```

That is the **development** Service ID, on the development tunnel, terminating
on a developer's machine. Deliberately.

#### 1. Why production is temporarily allowed to use the development Service

There is no other Service. AWS production Rails does not exist and neither does
a production tunnel, and creating either is outside this repository. The choice
is between a production Worker that exercises the real transport against local
Rails, and a production Worker that exercises nothing. The first fails visibly
when the laptop is off; the second fails invisibly on the day AWS arrives.

#### 2. This is a bootstrap topology, not the final one

```text
production Worker → Workers VPC → development VPC Service → development tunnel → local Rails
```

Every hop is real except the destination.

#### 3. What this arrangement verifies

The binding resolves in a deployed Worker; `env.<BINDING>.fetch()` works from
Cloudflare's edge rather than through a remote-binding proxy; the VPC Service
record routes; the tunnel carries edge-originated traffic; Rails dispatches on
the `Host` header the same way it does under `preview:vpc`; and a stopped origin
surfaces as `ProxyError: connection_refused` → `unreachable` → 503 rather than
as something ambiguous.

#### 4. What remains unverified until AWS Rails exists

Production latency and placement (the tunnel terminates on a laptop, not in a
region); production Rails' own behaviour under edge traffic; anything about the
production tunnel, its connector count or its failure modes; and whether a
production VPC Service behaves identically to this one. Availability is **not**
verified in any meaningful sense — it is bounded by a developer's machine.

#### 5. How the AWS cutover happens

1. Provision production Rails, a production tunnel beside it, and a production
   VPC Service on that tunnel. **Outside this repository.**
2. Set `vpcProductionServiceId` in `tools/workers-manifest.json` to the new id.
3. Set the fifteen top-level `service_id`s to the same value.
4. Deploy.

No application code changes, because none of it names an environment:
`getRailsClient()` selects the VPC transport by the presence of the runtime
binding. `tools/check-workers.mjs` fails the build if step 3 is done without
step 2, or if any of the fifteen is left behind.

#### 6. Why production does not set `remote: true`

`remote` is a **local-development** flag. It tells wrangler to run the Worker's
code in local workerd while proxying that one binding out to the real Cloudflare
resource instead of simulating it. A deployed Worker has no local simulation to
override, so the key means nothing there —
[Remote bindings](https://developers.cloudflare.com/workers/development-testing/#remote-bindings).
The
[VPC Services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)
page documents it only as "utilizes remote bindings to allow access to the VPC
Service during local development" and says nothing about deployment requiring
it. Setting it in production would be a key that reads as load-bearing and is
not; `tools/check-workers.mjs` therefore rejects it.

#### 7. Which guardrails changed, and why the old ones were no longer valid

| Guardrail                                                                           | Was                                                           | Now                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `check-workers.mjs` `NON_INHERITABLE`                                               | included `vpc_services`, so every env had to repeat it        | excludes it — a syntax rule cannot express "`env.test` gets none"    |
| `check-workers.mjs` VPC rules                                                       | binding in `env.vpc` only; top level forbidden                | one `VPC_POLICY` table, per tier: required id, and `remote` per tier |
| `rails-connection-invariants` "declares the binding once"                           | textual, asserted the string sat between `"vpc"` and `"test"` | structural, parses the config and asserts per tier                   |
| `rails-connection-invariants` "never lets production reuse the development service" | the rule this change contradicts                              | replaced by a cutover-shape assertion over the two manifest fields   |
| `verify-edge-connectivity.mjs` isolation note                                       | `FAIL` on a shared id; `WARN` on production having none       | `WARN` while the two manifest ids are equal, `FAIL` once they differ |

The retired rule was not weakened to make a test pass — it encoded decision 2,
and decision 2 is what this amendment supersedes. Its replacement still fails
loudly for the case it was written to catch: a frame left on the development
Service _after_ the cutover.

### Amendment, 2026-08-16 (Phase 2) — `env.development` gets the binding, and decision 1 pays for it

**Decision 1 above is superseded**, and so is the credential column of decision
3's table. `env.development` now declares:

```jsonc
"vpc_services": [
  {
    "binding": "UMAXICA_APPS_EDGE_CF_WORKERS_VPC",
    "service_id": "019f5fe0-287f-7040-9f2f-036cb5b21df7",
    "remote": true
  }
]
```

so the ordinary development loop reaches Rails over the real transport instead of
over a Node-only path that shares nothing with production.

#### What this costs, measured rather than assumed

ADR 005 and decision 1 both treated `remote: true` as a _choice_ whose cost could
be confined to one opt-in command. That framing is wrong, and the reason is in
wrangler itself:

```js
// wrangler/wrangler-dist/cli.js — getBindingLocalSupport
vpc_service: "DO-NOT-USE-this-resource-will-never-have-a-local-simulator",
```

A VPC Service has **no local simulator**, so wrangler wires it to a remote proxy
connection whether or not `remote` is set — setting `"remote": false` at the top
level was measured and changes nothing. Any local tooling that resolves a config
containing `vpc_services` therefore opens a remote proxy session, and that
session **rejects API-token authentication**:

```
RemoteSessionAuthenticationError: This Worker uses bindings that need to run remotely,
even when developing locally, but the remote session could not be authenticated.
It looks like you are authenticating via a custom API token (`CLOUDFLARE_API_TOKEN`)
```

`next dev` is included, because `*/next.config.ts` calls
`initOpenNextCloudflareForDev()`, which calls `getPlatformProxy()`. Measured on
`app/core`, with `CLOUDFLARE_ENV` set the way `compose.yaml` sets it:

| `CLOUDFLARE_ENV` | resolves        | before Phase 2             | after Phase 2                           |
| ---------------- | --------------- | -------------------------- | --------------------------------------- |
| `development`    | env.development | no VPC binding, no session | remote session attempted — login needed |
| _blank_          | top level       | no VPC binding, no session | remote session attempted — login needed |

**The two commands degrade differently, and the difference matters:**

- `pnpm preview` (and `deploy`, `upload`) **fail outright**. The OpenNext CLI
  reads the Worker's vars through `getEnvFromPlatformProxy()`, and the throw
  aborts the command.
- `pnpm dev` **keeps serving, but loses every Cloudflare binding.**
  `initOpenNextCloudflareForDev()` is fired and forgotten
  (`void initOpenNextCloudflareForDev()`), so the process survives — it reaches
  `✓ Ready` and logs one
  `Unhandled Rejection: … Failed to start the remote proxy session`. What it does
  not do is populate the Cloudflare context, so `REVISION`, `IMAGES`,
  `RATE_LIMITER` and the rest are absent along with the VPC binding.

  This is not theoretical. `pnpm --dir app/core run test:api` **fails**, and it
  passes on the same tree with the `vpc_services` blocks removed:

  ```
  --> api/standard-contract.hurl:80    GET {{base}}/revision
      jsonpath "$.timestamp"   actual: null   expected: matches /^\d{4}-\d{2}-\d{2}T/
  ```

  `/revision` reads `version_metadata`, which is one of the bindings the failed
  context would have carried. Measured with `CLOUDFLARE_ENV` unset **and** set to
  `development`, so neither tier escapes it.

So the property decision 1 protected — "ordinary local development needs no
Cloudflare account" — is **gone outright**. Without a `wrangler login` session,
`pnpm preview` does not run, and `pnpm dev` runs in a degraded state that fails
the repository's own HTTP-contract suite. `wrangler login` is now a prerequisite
of the development loop, not an opt-in for one command. That is the deliberate
price of having one transport instead of two; it is recorded here rather than
discovered later, and it is the first thing to undo if the price turns out to be
the wrong one.

#### The Node transport is unchanged, and still separate

A wrangler binding is not something a plain Node process can hold. `next dev`
never receives `UMAXICA_APPS_EDGE_CF_WORKERS_VPC` no matter what
`env.development` declares — it fails to _start_ without a session, which is a
different thing from acquiring the binding. `getRailsClient()`'s branch 2, gated
on `EDGE_LOCAL_NODE_RUNTIME=1` **and** `EDGE_LOCAL_RAILS_ENABLED=1`, is untouched
and is still the only Rails transport a Node runtime has.
`test/rails-connection-invariants.test.ts` asserts both halves so that
"`env.development` has a binding now" is never mistaken for "the flags are
redundant".

#### Deploying now needs the same session

The same mechanism reaches the deploy path, because
`opennextjs-cloudflare deploy`, `upload` and `preview` all call
`getEnvFromPlatformProxy()` → `getPlatformProxy()` to read the Worker's vars. With
a top-level `vpc_services` they open a remote proxy session and fail under an API
token. Run them the way `preview:vpc` is already run:

```bash
CLOUDFLARE_API_TOKEN= pnpm --filter umaxica-apps-edge-app-core run deploy
```

with an OAuth session present. Note that `wrangler` loads the repo-root `.env`
itself, so the token must be **blanked, not unset** — and for `wrangler dev` an
empty `--env-file` is also needed (`tools/vpc-probe/empty.env` exists for this).

`wrangler deploy` on its own is unaffected: it opens no session, and a
`--dry-run` confirms the binding attaches to the production Worker:

```
env.UMAXICA_APPS_EDGE_CF_WORKERS_VPC (019f5fe0-…)      VPC Service
```

#### `env.vpc` is retained

`preview:vpc` and `tools/vpc-probe` still point at it, and it is now the A/B
control against a restored `env.development` — same Service, same `remote: true`,
different tier. Removing it is a later cleanup, not part of this change.

#### Not verified end to end

The transport itself is **unproven** by this change. There is no `wrangler login`
session in this environment (`wrangler whoami` reports an API token read from
`CLOUDFLARE_API_TOKEN`), so `pnpm run check:vpc` cannot open a remote session at
all:

```
PASS  Binding resolved: env.UMAXICA_APPS_EDGE_CF_WORKERS_VPC (019f5fe0-…)  VPC Service  remote
FAIL  Failed to start the remote proxy session. … it's necessary to set a CLOUDFLARE_API_TOKEN
```

That first line is a config echo from wrangler's binding table, not evidence of a
live session — worth knowing, because it reads like a passing hop.

**This is also the root cause of the "broken" development VPC path.** The failure
is at hop 1 of six — local workerd → remote proxy session — and is an
authentication failure, not a VPC Service, tunnel, `cloudflared` or Rails
failure. Nothing downstream was reached, so nothing downstream is implicated. Log
in and rerun `pnpm run check:vpc` and `pnpm run check:preview:vpc` to exercise the
rest.

# Historical note

The development VPC environment remains current, but the Access fallback retained by this
ADR was removed by the 2026-08 Edge development environment refresh. See
`docs/development/cloudflare-development-network.md` for the active four-path model.
