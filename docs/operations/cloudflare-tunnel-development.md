# Cloudflare Tunnel development exposure

## Purpose

Make the local Edge development environment — the Hono apex workers and the content frames
running under Podman — reachable from its development / staging FQDNs through Cloudflare Tunnel,
so a browser anywhere can load the surface a developer is editing.

## Note: the measurement logs are archived observations

Everything under "Verification evidence" is a **dated log**, not an instruction. Those runs
predate the current bundler, so the asset paths and dev-server names in them are as they were on
the day. The ports, the statuses and the conclusions still hold — asset URLs were always taken
from the page that referenced them rather than guessed, so nothing there depends on the path
shape. The operational sections above the logs are current and are kept that way.

## Note: `/rails-health` was merged into `/health` (2026-08-12)

`/rails-health` no longer exists on any frame. Public health is now four
`text/plain` endpoints shared by Rails, Hono, Astro, and TanStack Start:

```text
GET /health                 human-readable aggregate (not a Kubernetes probe)
GET /health/startups        Kubernetes startupProbe
GET /health/livenesses      Kubernetes livenessProbe
GET /health/readinesses     Kubernetes readinessProbe
```

Operational probes stay `text/plain`. Rails-internal operational JSON
(`/health/liveness.json` and siblings) stays blocked on Core public FQDNs.
Edge verifies Rails privately via Rails `GET /api/v0/health.json` (ADR 016).
Each Edge runtime also serves its own self-health document at the same path
on the Edge origin (ADR 017); that document does not call Rails.

```bash
curl -s 127.0.0.1:5405/health
# status: ok
# startup: ok
# liveness: ok
# readiness: ok
```

The contract tables and gate descriptions below are current. **The recorded observation tables
further down are not rewritten** — they are measurements taken on a date, and at that date the route
was `/rails-health`. Read a `/rails-health` column in a results table as `/health`'s `rails` field.

## Ownership: an Edge-specific connector and tunnel

Edge runs its own `cloudflared` sidecar from `compose.yaml`. It uses an Edge-specific Tunnel
and `CLOUDFLARED_TOKEN` from this repository's own `.env`; it must never reuse Global's Tunnel ID or token. The two compose
projects share no Podman network.

The separation is load-bearing. Registering the Edge connector as a replica of Global's tunnel
would let Cloudflare select a connector that cannot reach the requested origin. This is not
hypothetical: it happened on 2026-09-04, and both repositories failed intermittently at once. See
the amendment in `adr/014-edge-owned-development-tunnel.md`.

`compose.yaml` pins `cloudflare/cloudflared:2026.8.2`, reads `CLOUDFLARED_TOKEN` **and nothing
else**, and starts with the standard Dev Container lifecycle. The token stays in the gitignored host
`.env` and is passed only to the sidecar.

There is deliberately one variable and no fallback chain. Global uses the same variable name in its
own `.env`, for a different tunnel: a Compose project interpolates the file beside its own compose
file, so one name holds two tunnels. The former `${EDGE_CLOUDFLARED_TOKEN:-${CLOUDFLARED_TOKEN:-}}`
chain is what silently turned a missing Edge token into a takeover of Global's tunnel. An unset
token must leave this tunnel down.

Because the name no longer distinguishes the two repositories, `scripts/dev-start --tunnel` decodes
the tunnel UUID from the configured token and refuses to start when a cloudflared container already
running on this host serves the same tunnel.

The variable is not marked required in the compose file, because compose interpolates the whole
file whichever services you name and the connector now shares that file with `core`: a `:?` guard
would stop `podman compose up core` on every machine that never runs a tunnel. `scripts/dev-start
--tunnel` enforces the token instead, checking the shell and `.env` both, and cloudflared exits
non-zero on an empty token under `restart: on-failure:3`.

To confirm two connectors are not sharing one tunnel, compare the token each container was created
with — they must differ:

```bash
for c in $(podman ps --format '{{.Names}}' | grep cloudflare); do
  printf '%s ' "$c"
  podman inspect "$c" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep TUNNEL_TOKEN | md5sum
done
```

## Naming policy

Development and staging regional surfaces use a **single subdomain label with a hyphen**:

```
docs-jp.umaxica.{app,com,org}
news-jp.umaxica.{app,com,org}
help-jp.umaxica.{app,com,org}
```

**This is intentional and current. It is not legacy, obsolete, or a migration target.** Do not
rewrite it to `docs.jp.umaxica.*`, `news.jp.umaxica.*`, or `help.jp.umaxica.*`.

**The region label (`jp` above) is a per-machine `.env` value, not a repository constant.** This
development environment's `.env` resolves it to `jp`; another developer's machine may set `us` and
name its own Edge Tunnel Public Hostnames, Access applications, and `EDGE_TUNNEL_HOSTS` override to
match. See ADR 014 §"Hostname region label is a per-machine `.env` parameter". Everything below shows
this machine's `jp` values.

**Why:** nesting the region as its own label adds a certificate level. Development and staging
deliberately avoid that cost, so the region is folded into one label instead.

`info` carries no region — it is a global surface, so it is `info.umaxica.{app,com,org}`.

**Core is the sole exception** and uses `jp.umaxica.{app,com,org}` (the region label straight on the
apex, no `core-` prefix), because it is the one surface where a frame and Rails share an FQDN.
`core-jp.umaxica.*` is the Rails tunnel's own private endpoint and stays non-browser-facing; it is
not Core's public hostname.

The rule is encoded once, in `tunnelHostFor()` in `tools/verify-edge-connectivity.mjs`, so the
checker cannot drift from the policy. `EDGE_TUNNEL_HOSTS` overrides it per workspace
(`app/docs=example.test,...`) for a developer working on their own hostnames.

## Scope

In scope: the four Hono apex workers and the twelve non-core content frames — sixteen
surfaces.

Out of scope:

- **Core** (`jp.umaxica.{app,com,org}`, `{app,com,org}/core`). Untouched here; it needs path-level
  ingress and is the final, separate piece of work.
- **Rails.** Its ingress (`core-jp.*`, `side-jp.*`) is unchanged.
- **Cloudflare Access on the twelve content frames.** Deferred until the four apexes are proven.
  Access on the apexes is in scope — see "Cloudflare Access".
- **`dev/apex`.** It deploys to Cloudflare Workers now, but the `.dev` zone is still delegated
  to Vercel DNS (`ns1/ns2.vercel-dns.com`), so Cloudflare has no hostname to publish it on and the
  workspace binds container loopback only. Moving the zone to Cloudflare DNS is the prerequisite
  for both a custom domain and the `www` redirect rule — see
  `docs/operations/net-www-canonicalisation.md`. (`dev/acme` was deleted.)

## Architecture

```text
Internet
  |
Cloudflare  (DNS, TLS, WAF, cache)
  |
Cloudflare Access  (identity; unauthenticated requests never reach the connector)
  |
Cloudflare Tunnel  (Edge-specific connector and token)
  |
local development machine
  |
Podman  ── Edge compose default network
  |
  +-- Hono          wrangler dev (local workerd)   :5101 :5201 :5301 :5401
  |
  +-- TanStack      vite dev (local workerd)       :5103 :5106 :5107 :5108
                                                   :5303 :5306 :5307 :5308
                                                   :5403 :5406 :5407 :5408
```

`compose.yaml` publishes every dev port to host `127.0.0.1` only. The Edge connector does not route
back through those host ports; it reaches `core:<port>` directly on the Edge compose default
network. Cloudflare Public Hostnames must use those service addresses and remain protected by
Cloudflare Access.

Global has no route to this compose network. The Workers VPC path is separate and one-way: Edge
Workers call Global/Rails through Global's VPC Service and Tunnel. It does not carry browser traffic
to Edge.

### Paths this diagram does NOT describe

Cloudflare Workers runtime traffic is a different graph and does not pass through the Tunnel:

```text
local workerd (pnpm preview:vpc) ── remote VPC binding ── development VPC Service ── Tunnel ── Rails
deployed Worker                  ── production VPC binding ── (bootstrap) the same development VPC Service ── Tunnel ── Rails
```

A Tunnel route does not turn a local Node process into a Workers runtime, and it does not supply a
Workers binding. See `docs/development/cloudflare-development-network.md` and ADR 006.

## Route table

Local origin is the `core` service on the Edge compose default network; `Port` is read from each workspace's own `dev`
script. Path is the whole host in every case.

| Application | Runtime  | External FQDN         | Local origin       | Port | Path | Status                     |
| ----------- | -------- | --------------------- | ------------------ | ---- | ---- | -------------------------- |
| `app/apex`  | Hono     | `umaxica.app`         | `http://core:5401` | 5401 | `/`  | replaces production Worker |
| `com/apex`  | Hono     | `umaxica.com`         | `http://core:5101` | 5101 | `/`  | replaces production Worker |
| `net/apex`  | Hono     | `umaxica.net`         | `http://core:5201` | 5201 | `/`  | replaces production Worker |
| `org/apex`  | Hono     | `umaxica.org`         | `http://core:5301` | 5301 | `/`  | replaces production Worker |
| `app/info`  | TanStack | `info.umaxica.app`    | `http://core:5403` | 5403 | `/`  | new hostname               |
| `com/info`  | TanStack | `info.umaxica.com`    | `http://core:5103` | 5103 | `/`  | new hostname               |
| `org/info`  | TanStack | `info.umaxica.org`    | `http://core:5303` | 5303 | `/`  | new hostname               |
| `app/docs`  | TanStack | `docs-jp.umaxica.app` | `http://core:5406` | 5406 | `/`  | new hostname               |
| `com/docs`  | TanStack | `docs-jp.umaxica.com` | `http://core:5106` | 5106 | `/`  | replaces production Worker |
| `org/docs`  | TanStack | `docs-jp.umaxica.org` | `http://core:5306` | 5306 | `/`  | new hostname               |
| `app/news`  | TanStack | `news-jp.umaxica.app` | `http://core:5407` | 5407 | `/`  | new hostname               |
| `com/news`  | TanStack | `news-jp.umaxica.com` | `http://core:5107` | 5107 | `/`  | replaces production Worker |
| `org/news`  | TanStack | `news-jp.umaxica.org` | `http://core:5307` | 5307 | `/`  | replaces production Worker |
| `app/help`  | TanStack | `help-jp.umaxica.app` | `http://core:5408` | 5408 | `/`  | new hostname               |
| `com/help`  | TanStack | `help-jp.umaxica.com` | `http://core:5108` | 5108 | `/`  | new hostname               |
| `org/help`  | TanStack | `help-jp.umaxica.org` | `http://core:5308` | 5308 | `/`  | replaces production Worker |

### Expected response per surface

A plain 200 is not the success condition. What each surface is supposed to answer:

These are the **authenticated** answers. Where Access is applied — the four apexes since
2026-08-11 — an unauthenticated request gets a 302 to the team domain on every path in this table,
`/health*` included, because there is no Bypass. That is the correct answer too, and the checker
records it as its own outcome rather than a failure.

| Route                                | Expected                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apex `/health.json`                  | 200, `service` equals the brand                                                                                                                                                                                                                               | `service` is a build-time literal from `createApexApp(..., { service })`, so it identifies which Worker answered. This is the only response-level proof against a brand mix-up                                                  |
| apex `/health`, `/health.html`       | 200, HTML                                                                                                                                                                                                                                                     | inline styles, no external assets                                                                                                                                                                                               |
| apex `/about`                        | 200, HTML                                                                                                                                                                                                                                                     | canonical is the production apex, which now equals the external FQDN                                                                                                                                                            |
| `{app,com,org}/apex` `/`             | **301** to `https://jp.umaxica.<brand>/`                                                                                                                                                                                                                      | hardcoded absolute URL in `src/root-redirect.ts`. As of 2026-08-10 that target resolves and is Access-protected (Core), so the redirect now lands somewhere real; the 301 itself is what is being asserted here, not the target |
| `net/apex` `/`                       | **301** to `/about`                                                                                                                                                                                                                                           | relative, host-preserving; `net/apex` has no `root-redirect.ts`                                                                                                                                                                 |
| apex non-GET                         | 404                                                                                                                                                                                                                                                           | the apex surface is GET-only                                                                                                                                                                                                    |
| apex non-GET with a foreign `Origin` | 403                                                                                                                                                                                                                                                           | `hono/csrf` allows only the four production apexes, `{com,org,app,net}.localhost`, and two-label `*.workers.dev`                                                                                                                |
| content frame `/`                    | 200, HTML containing `UMAXICA <Frame>`                                                                                                                                                                                                                        | identifies the FRAME only. The string is the same in all three brands' copies, so it cannot say which brand answered                                                                                                            |
| `info` `/health.json`                | 200, `service` equals the brand, `frame` equals `info`                                                                                                                                                                                                        | build-time literals, the content-frame equivalent of the apexes' `service`. This is the only response-level proof against a brand mix-up on a content frame. `docs`/`news`/`help` do not have it yet — see "Known limitations"  |
| content frame hashed asset           | 200                                                                                                                                                                                                                                                           | asset URL taken from the page that referenced it, never guessed                                                                                                                                                                 |
| content frame `/health`              | **503**, `rails.liveness.kind` `not-configured` The dev server has no VPC binding. A 200 here would mean the private Podman path is live, which is a different claim. The `edge` half of the same document is still `ok` — that is how the two are told apart |

## Verification procedure

Needs no credential. Nothing below stores or prints a token.

```bash
# 1. Put the Edge-specific connector token in the gitignored root `.env`:
#    CLOUDFLARED_TOKEN=<Edge tunnel token>
#    chmod 600 .env
#    In the devcontainer the connector starts automatically.
scripts/dev-start --tunnel     # only for the non-devcontainer path

# 2. Start each dev server needed for this check. The root has no dev fan-out.
pnpm --dir app/core run dev

# 3. Local origins, before involving Cloudflare at all.
pnpm run check:local          # HTTP reachability per port
podman inspect --format '{{json .NetworkSettings.Networks}}' <edge container>

# 4. The published hostnames, layer by layer.
pnpm run check:tunnel:apex    # the four Hono apexes only — do these first
pnpm run check:tunnel:edge    # all sixteen

# 5. Optional: the AUTHENTICATED half, once Access is in front. A service token
#    is a credential — export it in the shell, never in a file in this repo.
export CF_ACCESS_CLIENT_ID=[REDACTED] CF_ACCESS_CLIENT_SECRET=[REDACTED]
pnpm run check:tunnel:apex
```

`check:tunnel:edge` reports seven gates per surface and keeps the layers apart, because "it returned
502" and "the hostname is not configured" are different problems:

| Gate    | Proves                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dns`   | an A/CNAME exists, asked over DNS-over-HTTPS so a stale container resolver cannot fake it                                                                                                                                                                                                                                                              |
| `cf`    | TLS completed and `cf-ray` is present, so Cloudflare served it                                                                                                                                                                                                                                                                                         |
| `acs`   | Access, both halves. A 302 to the `*.cloudflareaccess.com` team domain **passes** the unauthenticated half and proves the connector was never contacted; no Access at all is a **WARN**. Without a service token the remaining gates are **BLOCKED** — unproven, deliberately not PASS. The login URL's query string carries a JWT and is never logged |
| `orig`  | the connector reached a listening origin. 502/503/521/522/523/530 are reported **BLOCKED**, meaning "that dev server is not running" — an ordinary state, not a failure                                                                                                                                                                                |
| `ident` | the intended application answered (apex `service`, or the frame marker in the HTML)                                                                                                                                                                                                                                                                    |
| `route` | a representative route behaves: apex `/` redirect target and `/about`; frames a hashed asset and `/health`                                                                                                                                                                                                                                             |
| `leak`  | no `localhost`, `127.0.0.1`, `edge-core`, or `0.0.0.0` in the redirect target or body                                                                                                                                                                                                                                                                  |

It is deliberately excluded from `check:connectivity` (`all`), because it depends on hostnames
someone configured in Cloudflare.

### Cloudflare-side configuration (done by the operator, not by this repository)

1. Create a dedicated Edge Tunnel and put its connector token in `.env` as
   `CLOUDFLARED_TOKEN`. Never reuse Global's Tunnel ID or token. Point each Public Hostname at
   `http://core:<port>` from the route table.
2. Remove the Worker custom domain from the four apex hostnames. A custom domain and a Tunnel
   Public Hostname cannot both own one name.
3. Remove the existing Worker routes from `docs-jp.umaxica.com`, `news-jp.umaxica.com`,
   `news-jp.umaxica.org`, and `help-jp.umaxica.org`.
4. Add the sixteen Public Hostname entries from the route table, plus a catch-all returning 404 so
   an unknown Host cannot fall through to an arbitrary service.
5. Add a Cache Rule bypassing cache for all sixteen hostnames. `docs-jp.umaxica.com` currently
   serves `cache-control: s-maxage=31536000`; without a bypass, stale production HTML would keep
   being served and dev responses would be cached at the edge. `public/_headers`
   (hashed assets → `immutable`) is interpreted by Workers Assets and does not apply on this
   path, so it must be bypassed too.

6. Add a Cloudflare Access application per hostname, with an Allow policy. The apexes go first — see
   "Cloudflare Access" for the shape and for the `/health*` decision.

**Do the four apexes first, all six steps, before touching the twelve content frames.** They are the
only surfaces whose brand is checkable from the response body, so a mistake in the ingress or the
policy shows up as a wrong `service` value instead of as an indistinguishable 200. `pnpm run
check:tunnel:apex` is exactly that subset.

#### State of those six steps — 2026-08-11

Measured as described in "Public Hostname state — 2026-08-11"; the dashboard list supplied the
entries and the measurement confirmed them.

| Step                                                        | State                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. connector on `umaxica-edge-tunnel`, Rails `core` aliased | done — a 502 (rather than 1033) proves the connector resolved `edge-core` at that moment                                                   |
| 2. Worker custom domains removed from the four apexes       | done — no A record on any of the four                                                                                                      |
| 3. Worker routes removed from the four live `-jp` hostnames | done — no A record on `docs-jp.com`, `news-jp.com`, `news-jp.org`, `help-jp.org`                                                           |
| 4. sixteen Public Hostname entries + catch-all 404          | **16/16 done.** Every subdomain, brand and port matches the route table. Catch-all **judged unnecessary** — confirm one exists, do not add |
| 5. Cache Rule bypassing cache on the sixteen hostnames      | **deliberately not applied** — the premise was not evidence; revisit if stale HTML is observed                                             |
| 6. Access application per hostname                          | **16/16 done.** `acs` ok on every surface, whole host including `/health*`, no Bypass anywhere                                             |

**The order was inverted: the twelve content frames went first, then the apexes.** Two consequences,
neither of which is a code change:

- The surfaces exposed first were the ones whose brand a human cannot verify without
  `/health.json` — which is why that route was added, and which `docs`/`news`/`help` still do not
  have. Had the apexes gone first as prescribed, a transposed entry would have been visible
  immediately.
- The exposure window is closed. The three `info` frames served live content unauthenticated from
  06:51 to 08:1x UTC; the apexes were closed at 08:0x and the nine `-jp` frames at 08:2x. Every
  surface reachable during that window was a development origin on a developer's machine.

**No operator work remains.** Steps 1–4 and 6 are done and measured; the catch-all and the Cache
Rule were examined and declined. Access covers the whole host on all sixteen with no `/health*`
Bypass (decided 2026-08-11, see "Cloudflare Access"). `adr/008-edge-development-tunnel-exposure.md`
carries the closeout.

#### Why the catch-all 404 was declined

Step 4 above calls it required, and the measurement behind that — `Host: nonsense.invalid` returns a
working 200 on every port, so the applications validate nothing — still holds. The conclusion does
not, because it was drawn when no surface had Access:

- **An unknown `Host` has no path to the connector.** The request must arrive via Cloudflare for a
  hostname whose DNS points at the tunnel. In this zone those records are created one at a time,
  deliberately, alongside the ingress entry — there are no wildcard or orphaned records.
- **`cloudflared` will not run without a catch-all.** It is required as the last ingress rule and a
  dashboard-managed tunnel supplies one, so this is a thing to confirm, not to add.
- **Access is what stands between the internet and the origins**, and it now covers all sixteen.

Keep the step in the procedure: it is correct for a tunnel that is published before Access, which is
the general case this document is also written for.

#### Why the Cache Rule was declined

The premise was that `docs-jp.umaxica.com` served `cache-control: s-maxage=31536000`, so stale
production HTML could keep being served from the edge. That is the header the **origin** sent; it is
not evidence Cloudflare cached anything, and Cloudflare does not cache HTML by default. The Access
302 was measured returning `cache-control: private, max-age=0, no-store`, so the redirect itself is
never cached.

Whether an authenticated response comes from cache cannot be decided unauthenticated —
`cf-cache-status` is not readable through the 302. Rather than configure against a hypothesis, this
waits until stale HTML is actually observed. If it is, bypass cache on the sixteen hostnames as step
5 describes, and note that `public/_headers` (hashed assets → `immutable`) is interpreted by
Workers Assets and does not apply on this path.

**Do not add ingress for:** `{app,com,org}/core` (5405/5105/5305, out of scope), `dev/apex`
(5501, out of scope while `.dev` is off Cloudflare DNS), the wrangler OAuth callback (8976), or the
wrangler inspectors (9101/9201/9301/9401/9501, not published at all).

## Verification evidence

### Local origins — 2026-08-10, all sixteen PASS

Run from inside the development container, before any Cloudflare configuration. Each surface was
probed on **both** addresses that matter: `127.0.0.1:<port>` (what the host publish reaches) and the
container's own network address (what `edge-core:<port>` resolves to for the connector). A surface
reachable on loopback but not on the container address would look healthy locally and 502 through
the Tunnel, so checking only one address proves nothing about the Tunnel.

Started in batches of four: the cgroup allows 2048 pids and each dev server spawns a heavily
threaded `workerd`, so all nineteen at once dies with `EAGAIN` on spawn. Batching is a local
constraint, not a limitation of the surfaces.

| Surface    | Port | `127.0.0.1` | container addr | Identity       | Representative route                                    | localhost leak |
| ---------- | ---- | ----------- | -------------- | -------------- | ------------------------------------------------------- | -------------- |
| `app/apex` | 5401 | 301         | 301            | `service=app`  | `/`→301 `https://jp.umaxica.app/`; `/about` 200         | none           |
| `com/apex` | 5101 | 301         | 301            | `service=com`  | `/`→301 `https://jp.umaxica.com/`; `/about` 200         | none           |
| `net/apex` | 5201 | 301         | 301            | `service=net`  | `/`→301 `/about`; `/about` 200                          | none           |
| `org/apex` | 5301 | 301         | 301            | `service=org`  | `/`→301 `https://jp.umaxica.org/`; `/about` 200         | none           |
| `app/info` | 5403 | 200         | 200            | `UMAXICA Info` | `_next` asset 200; `/rails-health` 503 `not-configured` | none           |
| `app/docs` | 5406 | 200         | 200            | `UMAXICA Docs` | as above                                                | none           |
| `app/news` | 5407 | 200         | 200            | `UMAXICA News` | as above                                                | none           |
| `app/help` | 5408 | 200         | 200            | `UMAXICA Help` | as above                                                | none           |
| `com/info` | 5103 | 200         | 200            | `UMAXICA Info` | as above                                                | none           |
| `com/docs` | 5106 | 200         | 200            | `UMAXICA Docs` | as above                                                | none           |
| `com/news` | 5107 | 200         | 200            | `UMAXICA News` | as above                                                | none           |
| `com/help` | 5108 | 200         | 200            | `UMAXICA Help` | as above                                                | none           |
| `org/info` | 5303 | 200         | 200            | `UMAXICA Info` | as above                                                | none           |
| `org/docs` | 5306 | 200         | 200            | `UMAXICA Docs` | as above                                                | none           |
| `org/news` | 5307 | 200         | 200            | `UMAXICA News` | as above                                                | none           |
| `org/help` | 5308 | 200         | 200            | `UMAXICA Help` | as above                                                | none           |

301 is the correct answer for an apex `/`, not a redirect problem — and note the `Location` values
are absolute production URLs or a relative path, never the origin's own address, which is what the
`leak` column records. `net/apex` answers `service=net` locally, which localises the production
`umaxica.net` misbinding to the Cloudflare dashboard rather than the code.

`/rails-health` answering 503 `not-configured` on all twelve frames is the expected result:
The dev server carries no VPC binding. A 200 would have meant the private Podman path was live, which is
a different claim entirely.

### Baseline before the cutover — 2026-08-10, from inside the development container

Captured with `node tools/verify-edge-connectivity.mjs tunnel` against the hostnames as they stood
**before** any Tunnel configuration. This is the "what was there" record, not a Tunnel result: at
this point every PASS below is a deployed Cloudflare Worker answering, not the Tunnel.

| FQDN                         | Result   | Status | Application                               | Route                                           | Notes                                   |
| ---------------------------- | -------- | ------ | ----------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| `umaxica.app`                | occupied | 200    | production apex Worker, `service=app`     | `/`→301 `https://jp.umaxica.app/`, `/about` 200 | correct binding                         |
| `umaxica.com`                | occupied | 200    | production apex Worker, `service=com`     | `/`→301 `https://jp.umaxica.com/`, `/about` 200 | correct binding                         |
| `umaxica.org`                | occupied | 200    | production apex Worker, `service=org`     | `/`→301 `https://jp.umaxica.org/`, `/about` 200 | correct binding                         |
| `umaxica.net`                | occupied | 200    | production apex Worker, **`service=app`** | `/`→301 `https://jp.umaxica.app/`               | **misbound** — see "Findings"           |
| `docs-jp.umaxica.com`        | occupied | 200    | OpenNext Worker, `UMAXICA Docs`           | `_next` asset 200, `/rails-health` **404**      | deployed build predates `/rails-health` |
| `news-jp.umaxica.com`        | occupied | 200    | OpenNext Worker, `UMAXICA News`           | `_next` asset 200, `/rails-health` **404**      | same                                    |
| `news-jp.umaxica.org`        | occupied | 200    | OpenNext Worker, `UMAXICA News`           | `_next` asset 200, `/rails-health` **404**      | same                                    |
| `help-jp.umaxica.org`        | occupied | 200    | OpenNext Worker, `UMAXICA Help`           | `_next` asset 200, `/rails-health` **404**      | same                                    |
| `info.umaxica.{app,com,org}` | free     | —      | none                                      | —                                               | no A/CNAME                              |
| `docs-jp.umaxica.{app,org}`  | free     | —      | none                                      | —                                               | no A/CNAME                              |
| `news-jp.umaxica.app`        | free     | —      | none                                      | —                                               | no A/CNAME                              |
| `help-jp.umaxica.{app,com}`  | free     | —      | none                                      | —                                               | no A/CNAME                              |

Unchanged and deliberately untouched, confirmed in the same run:

| FQDN                       | Status                               | Meaning                                                                             |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `core-jp.umaxica.app`      | 302 → `umaxica.cloudflareaccess.com` | Rails tunnel behind Access. Query string, including the `meta` JWT, is `[REDACTED]` |
| `side-jp.umaxica.app`      | 302 → `umaxica.cloudflareaccess.com` | same                                                                                |
| `jp.umaxica.{app,com,org}` | no A/CNAME                           | Core, still unpublished                                                             |

Raw capture: `tmp/connectivity-check/tunnel-baseline-2026-08-10.txt` (gitignored — regenerate with
`pnpm run check:tunnel:edge`).

**Both of the Core rows above have since moved** — remeasured later the same day, see
"DNS state — 2026-08-10 13:3x UTC". They are recorded here as the baseline said them, not as
current fact.

### DNS state — 2026-08-10 13:3x UTC, after the operator's Rails and Core work

Asked over DNS-over-HTTPS (`https://cloudflare-dns.com/dns-query`, `type=A`) so a stale container
resolver could not fake it. This is the state the Edge cutover starts from, and it is materially
different from the baseline above.

| FQDN                            | A record | Unauthenticated `GET /`               | Reading                                                 |
| ------------------------------- | -------- | ------------------------------------- | ------------------------------------------------------- |
| the sixteen Edge hostnames      | **none** | —                                     | no Public Hostname exists yet; 16/16 answer-less        |
| `auth.umaxica.{app,com,org}`    | yes      | 302 → `umaxica.cloudflareaccess.com/` | Rails, complete                                         |
| `www.umaxica.{app,com,org}`     | yes      | 302 → same                            | Rails, complete                                         |
| `side-jp.umaxica.{app,com,org}` | yes      | 302 → same                            | Rails, complete                                         |
| `palm-jp.umaxica.app`           | yes      | 302 → same                            | Rails, complete — see "Palm" below                      |
| `jp.umaxica.{app,com,org}`      | **yes**  | **302 → same**                        | Core: published and Access-protected since the baseline |
| `core-jp.umaxica.app`           | **none** | —                                     | Core: the record the baseline saw is gone               |

Two consequences for Edge, neither of which is a code change:

- **The eight hostnames the cutover replaces are currently dark.** `umaxica.{app,com,org,net}`,
  `docs-jp.umaxica.com`, `news-jp.umaxica.com`, `news-jp.umaxica.org`, and `help-jp.umaxica.org`
  were live production Workers in the baseline table. Their custom domains and Worker routes have
  been removed, but **no Public Hostname replaced them**, so they now resolve to nothing rather
  than to a developer's machine. The authorized cutover left a window open; it closes when the
  Public Hostnames are added.
- **The apex `/` redirect target now resolves.** `https://jp.umaxica.<brand>/` is live and behind
  Access. A browser following an apex 301 while authenticated reaches Core; while unauthenticated
  it reaches the Access login. Neither is an Edge defect, and neither changes what the apex
  surfaces are asserted to do.

Access login URLs carry a `meta` JWT in the query string and are `[REDACTED]` throughout.

### Local origins, second run — 2026-08-10 13:45–13:48 UTC, all sixteen PASS

Re-measured immediately before handing the route table to the operator, because the first run's
servers were no longer up and evidence that does not share a timestamp with the cutover is not
evidence for it. Same method as the first run: **both** addresses, and the production `Host` the
Tunnel will present.

Measured in batches of four, then re-checked with **all sixteen up simultaneously**: 16/16 answered
on `http://edge-core:<port>` at `pids.current` 1954 of the cgroup's 2048.

That corrects the earlier note that batching is required. It is not — but the headroom is 94 pids,
and that is not enough to do anything else. Measured at 1954: `oxfmt` aborts with
`ThreadPoolBuildError … WouldBlock` and `vitest` dies with `EPIPE`, both because the thread pool
cannot be created. **Repo tooling and a full sixteen-surface run are mutually exclusive.**

Roughly 155 pids per `wrangler dev` (heavily threaded `workerd`) and 109 per `next dev`; the four
apexes alone sit at 645, and four apexes plus four frames at ~1100. So: run all sixteen for a
Tunnel pass that needs every hostname live at once, and run nothing else during it; drop to a
batch before running `format:check`, `typecheck`, or the test suite.

| Surface    | Port | `127.0.0.1` | `10.89.4.2` | Identity                         | Representative route                                                       | leak |
| ---------- | ---- | ----------- | ----------- | -------------------------------- | -------------------------------------------------------------------------- | ---- |
| `app/apex` | 5401 | 301         | 301         | `service=app`, `env=development` | `/`→301 `https://jp.umaxica.app/`; `/about` 200; `POST /` 403; `/nope` 404 | none |
| `com/apex` | 5101 | 301         | 301         | `service=com`, `env=development` | `/`→301 `https://jp.umaxica.com/`; rest as above                           | none |
| `net/apex` | 5201 | 301         | 301         | `service=net`, `env=development` | `/`→301 `/about` (**relative**, raw header); rest as above                 | none |
| `org/apex` | 5301 | 301         | 301         | `service=org`, `env=development` | `/`→301 `https://jp.umaxica.org/`; rest as above                           | none |
| `app/info` | 5403 | 200         | 200         | `UMAXICA Info`                   | CSS 200, JS 200, `/rails-health` 503 `not-configured`, no `Location`       | none |
| `app/docs` | 5406 | 200         | 200         | `UMAXICA Docs`                   | as above                                                                   | none |
| `app/news` | 5407 | 200         | 200         | `UMAXICA News`                   | as above                                                                   | none |
| `app/help` | 5408 | 200         | 200         | `UMAXICA Help`                   | as above                                                                   | none |
| `com/info` | 5103 | 200         | 200         | `UMAXICA Info`                   | as above                                                                   | none |
| `com/docs` | 5106 | 200         | 200         | `UMAXICA Docs`                   | as above                                                                   | none |
| `com/news` | 5107 | 200         | 200         | `UMAXICA News`                   | as above                                                                   | none |
| `com/help` | 5108 | 200         | 200         | `UMAXICA Help`                   | as above                                                                   | none |
| `org/info` | 5303 | 200         | 200         | `UMAXICA Info`                   | as above                                                                   | none |
| `org/docs` | 5306 | 200         | 200         | `UMAXICA Docs`                   | as above                                                                   | none |
| `org/news` | 5307 | 200         | 200         | `UMAXICA News`                   | as above                                                                   | none |
| `org/help` | 5308 | 200         | 200         | `UMAXICA Help`                   | as above                                                                   | none |

Four things this run added over the first:

- **`edge-core` was exercised by name, not only by address.** `getent hosts edge-core` →
  `10.89.4.2`, and `curl http://edge-core:5401/health.json` answered `service=app`,
  `environment=development`. That is the literal string the Public Hostname entries will contain,
  so it is now measured rather than inferred from the compose file.
- **`environment=development` is present on all four apexes.** This is the discriminator that tells
  the Tunnel apart from a deployed Worker after the cutover; the deployed Worker's response has no
  such field.
- **JS and CSS were checked separately.** The first `/_next/static/` reference in these pages is a
  stylesheet, so probing only "the first asset" never touches a script. Both a `.css` and a `.js`
  chunk answered 200 on all twelve frames, on both addresses.
- **`net/apex`'s raw `Location` header is `/about`** — verified with `curl -I` rather than curl's
  resolved display, which renders it as `http://10.89.4.2:5201/about` and looks like a leak.

The leak scan covered `Location` plus the body of `/`, `/about`, and `/health.json` for
`localhost`, `127.0.0.1`, `edge-core`, `0.0.0.0`, and `10.89.*`: no match on any of the sixteen.

**Host validation is still absent, on frames as well as apexes.** `Host: nonsense.invalid` returns
`service=app` 200 on 5401 and a working page 200 on 5306. The catch-all is therefore a required
part of the ingress configuration, not a hardening extra.

**Confirmed not listening**, so they cannot be published even by mistake: 5105/5305/5405 (Core),
5501/5502 (Vercel), 8976 (wrangler OAuth), 9101/9201/9301/9401 (inspectors).

### `info` surface identity added, local origins re-verified — 2026-08-11 05:38–05:44 UTC

Scope of this run: the three `info` frames only. `docs`, `news`, `help`, the four apexes and Core
were not re-measured and their rows above stand as previously recorded.

**What changed in the applications.** `{app,com,org}/info/src/app/health.json/route.ts` — a Route
Handler answering `{"status":"OK","service":"<brand>","frame":"info","environment":…,"time":…}`,
with `service` and `frame` as build-time literals. It exists because the preflight measurement
found the three frames indistinguishable in **every** response: identical markup, identical
response headers, identical `/rails-health` body, and the one per-brand value in the source
(`PRIVATE_RAILS_ORIGIN`) never reaches a response. A Public Hostname entry that sent
`info.umaxica.com` to port 5403 would have answered exactly like a correct one, so
"correct FQDN → correct application" was not merely unproven but unprovable.

`service` is deliberately not read from the `Host` header — a value echoed back from the request
proves nothing about which application received it. `test/tunnel-surface-identity.test.ts` pins the
three literals, asserts they are distinct, and asserts the handler takes no `Request`.
`tools/verify-edge-connectivity.mjs`'s `ident` gate now requires the brand where the route exists
and reports WARN where it does not.

**Measured, from inside the development container, on both addresses** — `127.0.0.1:<port>` (the
host publish) and `edge-core:<port>` by name (the literal string the Public Hostname entries will
contain). Every request carried the production `Host` the Tunnel will present.

| Surface    | Port | External FQDN      | `/` | CSS | JS  | `/health.json`     | `/rails-health`      | Local result |
| ---------- | ---- | ------------------ | --- | --- | --- | ------------------ | -------------------- | ------------ |
| `app/info` | 5403 | `info.umaxica.app` | 200 | 200 | 200 | 200 `app` / `info` | 503 `not-configured` | **PASS**     |
| `com/info` | 5103 | `info.umaxica.com` | 200 | 200 | 200 | 200 `com` / `info` | 503 `not-configured` | **PASS**     |
| `org/info` | 5303 | `info.umaxica.org` | 200 | 200 | 200 | 200 `org` / `info` | 503 `not-configured` | **PASS**     |

Identical results on `127.0.0.1` and on `edge-core`. Asset URLs were taken from the page that
referenced them, never guessed, and CSS and JS were fetched separately — the first `/_next/static/`
reference in these pages is a stylesheet, so probing "the first asset" never touches a script.
`environment` was `development` on all three, which is the discriminator that will tell the Tunnel
apart from a deployed Worker after the cutover.

Also established in the same run:

- **Client navigation works.** A `RSC: 1` request to `/` answers `307 → /?_rsc` and then 200
  `text/x-component`. The `Location` is relative and host-preserving, so nothing local leaks.
- **`/health.json` is independent of the request.** Each port answered with its own `service` under
  all four `Host` values tried — the two sibling brands' hostnames and `nonsense.invalid` — which is
  what makes it usable as mix-up evidence rather than an echo.
- **Host validation is absent on the `info` frames too**, consistent with every other surface here:
  `Host: nonsense.invalid` returns a working 200 page on all three ports, and each port serves the
  other two brands' hostnames. Brand isolation is therefore an ingress property alone, and the
  catch-all 404 is a required part of the configuration rather than a hardening extra.
- **Leak scan clean.** No `localhost`, `127.0.0.1`, `0.0.0.0`, `edge-core` or `10.89.*` in the body
  or in any `Location`, on any of the three. `/` sets no `Location` at all.
- **Repository checks pass** with the change in place: `format:check`, `lint`, `lint:types`, `typecheck`,
  and 1247 tests across 165 files.

Nothing outside the three `info` workspaces, the identity test, and the checker's `ident` gate was
modified. Core, the Workers VPC transport, the apexes, and Rails were not touched.

### Public Hostname state — 2026-08-11 06:25–06:30 UTC, three of sixteen configured

The operator's Public Hostname list was read off the Cloudflare dashboard. It is the first change to
the external state since the route table was handed over, and it contradicts the "sixteen
hostnames, none published" record above — so the claim is measured here rather than taken from the
dashboard alone.

**Edge hostnames, asked over DNS-over-HTTPS** (`https://cloudflare-dns.com/dns-query`, `type=A` and
`type=CNAME`), so a stale container resolver cannot fake it:

| FQDN                                            | A                            | CNAME | Reading            |
| ----------------------------------------------- | ---------------------------- | ----- | ------------------ |
| `info.umaxica.app`                              | 104.21.91.80, 172.67.212.131 | none  | published, proxied |
| `info.umaxica.com`                              | 104.21.15.105, 172.67.162.44 | none  | published, proxied |
| `info.umaxica.org`                              | 104.21.90.11, 172.67.193.76  | none  | published, proxied |
| `umaxica.{app,com,org,net}`                     | **none**                     | —     | still dark         |
| `docs-jp`/`news-jp`/`help-jp` × `{app,com,org}` | **none**                     | —     | not published      |

Unchanged in the same run, consistent with the 13:3x DNS state: `jp.umaxica.app` has an A record
(Rails-side, see below) and `core-jp.umaxica.app` still has none.

**HTTP — `info.umaxica.app` only.** The development container's resolver answers
`info.umaxica.app` but returns `Could not resolve host` for `info.umaxica.com` and
`info.umaxica.org`, so only one of the three could be probed from here. The other two are
**not measured**, which is not the same as passing.

| Time (UTC)   | Path           | Status                      | `cf-ray` | Reading                                                           |
| ------------ | -------------- | --------------------------- | -------- | ----------------------------------------------------------------- |
| 06:2x        | `/health.json` | 502                         | present  | connector reached; `edge-core:5403` not listening — no dev server |
| 06:2x        | `/`            | 502                         | present  | same                                                              |
| 06:29:02     | `/`            | **530**, `error code: 1033` | present  | no connector on the tunnel at that moment                         |
| 06:29:31 × 5 | `/`            | 530 × 5                     | present  | stable, so 530 is the state and not a single flake                |

Three things this establishes:

- **The hostname is bound to the Tunnel, not to a Worker.** 502 and 1033 are both tunnel-path
  answers; a deployed Worker would have served a page. With no CNAME and proxied A records, these
  are Public Hostname entries.
- **Access is NOT applied to the three `info` hostnames.** An Access application with an Allow
  policy answers an unauthenticated request with a 302 to `umaxica.cloudflareaccess.com` and never
  contacts the connector. `/` — which the `/health*` Bypass does **not** cover — returned 502 and
  then 530, so the request reached the tunnel path unauthenticated. `/health.json` alone could not
  have decided this: the Bypass produces the same answer either way. This is the highest-priority
  gap, because the moment a dev server starts, the surface is on the internet unauthenticated.
- **The connector is not continuously up.** 502 at 06:2x and 1033 from 06:29:02 onward is the
  connector leaving the tunnel between the two measurements. The Rails repository owns it; recorded
  here only so that a 530 on an Edge hostname is not read as an Edge fault.

The port mapping in the three configured entries is correct — 5403/5103/5303 against
`{app,com,org}` respectively — so there is no transposition of the kind `/health.json` was added to
catch. That remains **unproven rather than passed**: it cannot be checked until an origin answers.

Reproduce with:

```bash
# A/CNAME, bypassing the container resolver
curl -s -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=info.umaxica.app&type=A'

# Access present or absent — probe `/`, never `/health*`, which is Bypassed
curl -s -o /dev/null -D - https://info.umaxica.app/
```

### The twelve content frames published — 2026-08-11 06:45–06:55 UTC, first external PASS

The operator added the nine `docs-jp`/`news-jp`/`help-jp` entries, bringing the content frames to
12/12. **This is the first time any gate past `dns` has passed against a real hostname**, so it is
also the first evidence that the Tunnel path works end to end rather than only that the local
origins do.

All twelve entries were checked against the route table one by one: every subdomain, brand and port
matches. Confirmed over DNS-over-HTTPS — twelve A records present, and `umaxica.{app,com,org,net}`
still with none.

`pnpm run check:tunnel:edge`, seven gates per surface:

| Surface     | dns  | cf   | acs  | orig | ident | route | leak |
| ----------- | ---- | ---- | ---- | ---- | ----- | ----- | ---- |
| `*/APEX` ×4 | FAIL | skip | skip | skip | skip  | skip  | skip |
| `*/INFO` ×3 | ok   | ok   | warn | ok   | ok    | ok    | ok   |
| `*/DOCS` ×3 | ok   | ok   | warn | skip | skip  | skip  | skip |
| `*/NEWS` ×3 | ok   | ok   | warn | skip | skip  | skip  | skip |
| `*/HELP` ×3 | ok   | ok   | warn | skip | skip  | skip  | skip |

Reading each column:

- **`dns` FAIL on the four apexes** is the state, not a regression: they still have no Public
  Hostname. Everything downstream is `skip` because there is nothing to ask.
- **`orig` skip on nine frames** is `502`, which the checker reports as BLOCKED — those dev servers
  were not running. It says nothing about whether their ports are right, so **the nine
  `docs`/`news`/`help` port mappings are still unverified**. They also have no `/health.json`, so
  even with the servers up, `ident` would only confirm the frame and report WARN for the brand.
- **`ident` ok on the three `info` frames** is the substantive result. Measured directly:

  ```
  info.umaxica.app  {"status":"OK","service":"app","frame":"info","environment":"development",…}
  info.umaxica.com  {"status":"OK","service":"com","frame":"info","environment":"development",…}
  info.umaxica.org  {"status":"OK","service":"org","frame":"info","environment":"development",…}
  ```

  `service` equals the brand on all three, so the ingress is not transposed — the failure that a 200
  alone cannot detect, and the reason the route was added. `environment=development` proves the
  Tunnel answered and not a deployed Worker.

- **`route` ok** — a `/_next/static/chunks/…` asset 200 and `/rails-health` **503 `not-configured`**
  on all three. The 503 is the correct answer: the dev server carries no VPC binding, and a 200 there
  would have meant the private Podman path was live.
- **`leak` ok** — no `localhost`, `127.0.0.1`, `edge-core`, `0.0.0.0` or `10.89.*` in any body or
  `Location`.
- **`acs` WARN on all twelve.** No Access application exists on any published hostname. The three
  `info` frames are therefore serving live development content to the internet with no
  authentication, which the 200 above is direct evidence of. This is the open risk, not a checker
  artefact.

### The four apexes published — 2026-08-11 07:0x UTC, sixteen of sixteen

The operator added the four apex entries, completing step 4. Checked one by one against the route
table: `umaxica.app`→5401, `umaxica.com`→5101, `umaxica.net`→5201, `umaxica.org`→5301 — all four
correct. DNS-over-HTTPS returns A records for all four, where an hour earlier it returned none.

`pnpm run check:tunnel:apex`:

| Surface    | dns | cf  | acs  | orig | ident | route | leak |
| ---------- | --- | --- | ---- | ---- | ----- | ----- | ---- |
| `APP/APEX` | ok  | ok  | warn | skip | skip  | skip  | skip |
| `COM/APEX` | ok  | ok  | warn | skip | skip  | skip  | skip |
| `NET/APEX` | ok  | ok  | warn | skip | skip  | skip  | skip |
| `ORG/APEX` | ok  | ok  | warn | skip | skip  | skip  | skip |

`dns` and `cf` flipped from FAIL to ok, which is the cutover's own acceptance test for the DNS
layer. Everything from `orig` on is BLOCKED at 502 — `wrangler dev` was not running for any of the
four — so **apex identity is still unverified**, and with it the `umaxica.net` misbinding that these
four hostnames exist to expose. `acs` is WARN on all four: no Access, same as the twelve.

Note what 502 means for these four specifically. They are production hostnames. Before this step
they returned no DNS answer at all; now they return a Cloudflare 502 whenever the development
machine is not serving. That is the authorized cutover working as designed, not a regression — but
it is a live 502 on `umaxica.com`, not a quiet one.

### All sixteen verified through the Tunnel — 2026-08-11 07:00–07:40 UTC

The first run with every hostname published **and** origins actually serving. Run in two batches
because sixteen dev servers plus repo tooling do not fit the cgroup's 2048 pids: the four apexes
first (peak 953), then the twelve content frames (peak 1364).

**The four apexes — 4/4 PASS on every gate but `acs`.** Measured per hostname, each with the
production `Host` the Tunnel presents:

| FQDN          | `/health.json`                       | `/`                             | `/about` | `POST /` | `/nope` | leak |
| ------------- | ------------------------------------ | ------------------------------- | -------- | -------- | ------- | ---- |
| `umaxica.app` | 200 `service=app`, `env=development` | 301 → `https://jp.umaxica.app/` | 200      | 403      | 404     | none |
| `umaxica.com` | 200 `service=com`, `env=development` | 301 → `https://jp.umaxica.com/` | 200      | 403      | 404     | none |
| `umaxica.net` | 200 `service=net`, `env=development` | 301 → `/about` (relative)       | 200      | 403      | 404     | none |
| `umaxica.org` | 200 `service=org`, `env=development` | 301 → `https://jp.umaxica.org/` | 200      | 403      | 404     | none |

`service` equals the brand on all four, so the ingress is not transposed. `environment=development`
on all four proves the Tunnel answered rather than a deployed Worker — the cutover's own acceptance
test, and it now passes where the 2026-08-10 apex baseline recorded `identity FAIL, environment
absent`.

**`umaxica.net` answers `service=net` through the Tunnel.** The production misbinding to the
`app/apex` Worker is masked, exactly as this document predicted. It is not fixed — see "Findings
that need separate attention".

**The twelve content frames — 12/12 reachable.** Every one returned 200 with its frame marker
(`UMAXICA Info`/`Docs`/`News`/`Help`), `/rails-health` **503 `not-configured`**, a `_next` asset
200, and no `localhost`/`127.0.0.1`/`edge-core`/`0.0.0.0`/`10.89.*` in body or `Location`. The three
`info` frames additionally returned `/health.json` with `service` equal to the brand.

#### The nine `docs`/`news`/`help` brand mappings, resolved by ablation

The `ident` gate reports WARN on these nine because they carry no `/health.json` and all three
brands' HTML is byte-identical — this document has recorded their brand correctness as resting "on
the ingress table alone". It does not have to. **Stopping one brand's dev servers and observing
which hostnames go 502 decides the mapping from outside**, without adding a route to the
applications.

Three rounds, each with the other two brands left running:

| Round      | Ports stopped    | 502                                       | still 200                   |
| ---------- | ---------------- | ----------------------------------------- | --------------------------- |
| `app` down | 5406, 5407, 5408 | `docs-jp`/`news-jp`/`help-jp.umaxica.app` | the six `.com`/`.org` hosts |
| `com` down | 5106, 5107, 5108 | `docs-jp`/`news-jp`/`help-jp.umaxica.com` | the six `.app`/`.org` hosts |
| `org` down | 5306, 5307, 5308 | `docs-jp`/`news-jp`/`help-jp.umaxica.org` | the six `.app`/`.com` hosts |

Each round isolated exactly the three expected hostnames. Combined with the frame marker in the
HTML — which identifies the frame but not the brand — this pins all nine mappings: **the marker
gives the frame, the ablation gives the brand.** A transposition such as
`docs-jp.umaxica.com → 5406` would have kept that hostname at 200 during the `com` round and taken
it down during the `app` round; neither happened.

This closes the "brand mix-up is unverifiable on the other nine" limitation as a _measurement_ — it
does not add a response-level check, so it must be redone by hand after any ingress edit. Adding
`/health.json` to `docs`/`news`/`help` remains the way to make it continuous.

#### What is still not proven

- **`acs` WARN on all sixteen.** No Access application on any hostname. Every surface above was
  reached unauthenticated, from outside, over the public internet.
- **The authenticated half.** No service token is used, by decision; those gates stay BLOCKED.
- **The catch-all 404.** Not visible in the Public Hostname list and not externally testable — an
  unrouted hostname has no DNS record to probe. Confirm it in the dashboard.
- **The Cache Rule.** Not decidable from the hostname list.

`umaxica.app` failed the `dns` gate on the first checker run and passed on the next, with a
DNS-over-HTTPS query returning an empty answer once in three attempts — record propagation
settling minutes after the entry was added. Recorded so a single `dns` FAIL right after a change is
read as propagation rather than a missing entry; re-run before investigating.

### Access applied to the four apexes — 2026-08-11 08:0x UTC

The operator added an Access application to each of `umaxica.{app,com,net,org}`. Measured
unauthenticated, from inside the development container, with all four dev servers running:

| Path           | Result                                                |
| -------------- | ----------------------------------------------------- |
| `/`            | **302** → `umaxica.cloudflareaccess.com/…` (all four) |
| `/about`       | **302** → same                                        |
| `/health`      | **302** → same                                        |
| `/health.json` | **302** → same                                        |
| `/health.html` | **302** → same                                        |

This is the target shape from "Cloudflare Access": the connector is never contacted, so the origin
is unreachable to an unauthenticated caller. Login URLs carry a `meta` JWT in the query string and
are `[REDACTED]` throughout.

The origins were confirmed alive on `127.0.0.1:{5401,5101,5201,5301}/health.json` → 200 in the same
run, so the 302 is the authentication layer and not a dead application.

`/health*` is deliberately included — see "Cloudflare Access" for the 2026-08-11 reversal and what
it costs. Consequences observed immediately:

```
$ scripts/check-apex-domains
FAIL umaxica.com served by <unreachable>/apex (want com/apex)
FAIL umaxica.net served by <unreachable>/apex (want net/apex)
FAIL umaxica.org served by <unreachable>/apex (want org/apex)
FAIL umaxica.app served by <unreachable>/apex (want app/apex)
```

and `check:tunnel:apex`:

| Surface     | dns | cf  | acs    | orig | ident | route | leak |
| ----------- | --- | --- | ------ | ---- | ----- | ----- | ---- |
| `*/APEX` ×4 | ok  | ok  | **ok** | blkd | blkd  | blkd  | blkd |

`acs` moved from WARN to ok on all four — the first gate on this page to record Access actually
working. Everything downstream is BLOCKED for want of a credential, which is the intended reporting:
unproven, deliberately not PASS.

**The three `info` frames were still unauthenticated in the same run** — `/` returned 200 on all
three. Access has not been applied to the twelve content frames.

### Access applied to the three `info` frames — 2026-08-11 08:1x UTC, 7/16 protected

Same shape as the apexes, whole host, no `/health*` Bypass. Measured unauthenticated with all three
dev servers running:

| FQDN               | `/`     | `/health.json` | `/rails-health` |
| ------------------ | ------- | -------------- | --------------- |
| `info.umaxica.app` | **302** | **302**        | **302**         |
| `info.umaxica.com` | **302** | **302**        | **302**         |
| `info.umaxica.org` | **302** | **302**        | **302**         |

All to `umaxica.cloudflareaccess.com/…`, `[REDACTED]`. Origins confirmed alive in the same run —
`127.0.0.1:{5403,5103,5303}/health.json` → 200 — so the 302 is the authentication layer, not a dead
application. These three had been answering 200 unauthenticated since 06:51 UTC; that window is now
closed.

`check:tunnel:edge` after the change:

| Surface     | dns | cf  | acs      | orig | ident | route | leak |
| ----------- | --- | --- | -------- | ---- | ----- | ----- | ---- |
| `*/APEX` ×4 | ok  | ok  | **ok**   | blkd | blkd  | blkd  | blkd |
| `*/INFO` ×3 | ok  | ok  | **ok**   | blkd | blkd  | blkd  | blkd |
| `*/DOCS` ×3 | ok  | ok  | **warn** | skip | skip  | skip  | skip |
| `*/NEWS` ×3 | ok  | ok  | **warn** | skip | skip  | skip  | skip |
| `*/HELP` ×3 | ok  | ok  | **warn** | skip | skip  | skip  | skip |

Seven surfaces at `acs` ok, nine still WARN. The nine `-jp` frames were 502 during this run (dev
servers down) and remain reachable unauthenticated the moment one starts.

**The ablation technique is no longer available on a protected surface.** Stopping a dev server and
observing which hostnames 502 only works while requests reach the origin; behind Access every path
answers 302 regardless. The nine `-jp` mappings were fixed by the 07:00–07:40 ablation and stand,
but re-verifying them after a future ingress edit will require removing Access temporarily or using
a service token. Applying Access to those nine closes the last window in which that check is cheap.

### Access complete — 2026-08-11 08:2x UTC, 16/16

The nine `-jp` frames received Access applications, completing step 6. Measured unauthenticated
across every hostname in the route table:

| Surface group                                         | `/`     | `/health.json` | Access |
| ----------------------------------------------------- | ------- | -------------- | ------ |
| `umaxica.{app,com,net,org}`                           | **302** | **302**        | ok     |
| `info.umaxica.{app,com,org}`                          | **302** | **302**        | ok     |
| `docs-jp`/`news-jp`/`help-jp`.`umaxica.{app,com,org}` | **302** | **302**        | ok     |

Sixteen of sixteen, every path, all to `umaxica.cloudflareaccess.com/…` (`[REDACTED]`). No Edge
surface answers an unauthenticated request. `check:tunnel:edge`:

| Surface     | dns | cf  | acs    | orig | ident | route | leak |
| ----------- | --- | --- | ------ | ---- | ----- | ----- | ---- |
| all sixteen | ok  | ok  | **ok** | blkd | blkd  | blkd  | blkd |

`acs` ok on all sixteen, with no WARN rows left — the first run in this document where every
surface's Access gate passes. Everything from `orig` on is BLOCKED for want of a service token,
which is the intended reporting: unproven, deliberately not PASS.

The target shape from "Cloudflare Access" is now reached on every surface:

```text
external FQDN ── Cloudflare ── Access ──X   (302 to the team domain; connector never contacted)
```

**This is also the point at which the checker stops being able to tell these sixteen apart.** Every
surface now returns an identical 302 regardless of which application, which port, or whether
anything is listening at all. The identity evidence in this document — the apexes' `service`, the
`info` frames' `service`/`frame`, and the nine `-jp` frames' ablation — was all gathered before
08:2x UTC and is the last machine-made reading of any of them. Re-verification requires a browser or
a service token.

### Access rejection verified from the public internet — 2026-08-11, 16/16 good

An acceptance pass over every path by which Edge traffic crosses the Tunnel, asking one question:
does an unauthenticated caller on the public internet get refused?

**Measured with all sixteen dev servers stopped.** That is the stronger condition, not a weaker one:
with no origin listening, a hostname _without_ Access answers a Cloudflare 502, because the
connector is contacted and finds nothing. Every one answered **302** instead. The refusal therefore
happens before the connector is reached, which is the property being asserted.

#### A. Browser → Tunnel → Edge (ingress) — sixteen paths, Access **y**, all **good**

| Hostname                        | Origin                       | Access | Verdict  |
| ------------------------------- | ---------------------------- | ------ | -------- |
| `umaxica.app`                   | `edge-core:5401`             | **y**  | **good** |
| `umaxica.com`                   | `edge-core:5101`             | **y**  | **good** |
| `umaxica.net`                   | `edge-core:5201`             | **y**  | **good** |
| `umaxica.org`                   | `edge-core:5301`             | **y**  | **good** |
| `info.umaxica.app`              | `edge-core:5403`             | **y**  | **good** |
| `info.umaxica.com`              | `edge-core:5103`             | **y**  | **good** |
| `info.umaxica.org`              | `edge-core:5303`             | **y**  | **good** |
| `docs-jp.umaxica.{app,com,org}` | `edge-core:{5406,5106,5306}` | **y**  | **good** |
| `news-jp.umaxica.{app,com,org}` | `edge-core:{5407,5107,5307}` | **y**  | **good** |
| `help-jp.umaxica.{app,com,org}` | `edge-core:{5408,5108,5308}` | **y**  | **good** |

All sixteen: `302` with `Location` on `umaxica.cloudflareaccess.com` (`[REDACTED]`). Widened on a
sample of four hostnames — two apexes and two content frames — and every one also answered 302:

- **eight paths**: `/`, `/about`, `/health`, `/health.json`, `/health.html`, `/rails-health`,
  `/_next/static/…`, `/nope`
- **non-GET**: `POST /`, `HEAD /about`
- **forged credentials**: a made-up `CF_Authorization` cookie, and a made-up
  `CF-Access-Client-Id` / `CF-Access-Client-Secret` pair

**No application-derived response escaped at any point.** No 200, no 403, no 404, no 502 — 302 in
every case. In particular `/health*` answering 302 is the visible consequence of declining the
Bypass, and `POST /` answering 302 rather than the apex's own 403 shows Access refusing before the
application's CSRF middleware is reached.

#### B. Edge Worker → VPC Service → Tunnel → Rails (egress) — one path, Access **n** by design

The fifteen Rails-backed frames reach Rails over the **same** development tunnel
(`1d501e9a-…`) through one VPC Service (`019f5fe0-…`), declared only under `env.vpc`, dispatched to
fifteen entry points by `Host` alone. It crosses the Tunnel, so it belongs in this inventory, but it
is not a Public Hostname and it carries no Access. ADR 006:

> Access belongs at **browser → Edge** ingress. Workers VPC is **Edge → private origin** egress.
> Neither substitutes for the other.

**Not measured in this pass.** Exercising it needs `pnpm preview:vpc` and an interactive
`wrangler login`, which was outside a read-only acceptance run. The **n** above is a design
statement; it is not a reachability result, and nothing here should be read as one.

Confirmed by reading instead: the ADR 005 Access fallback via `core-jp.umaxica.app` is **gone from
the code**. `<brand>/<frame>/src/lib/rails-client.ts` has exactly two branches — the VPC binding and
the local-Node flags — and contains no `cloudflareaccess`, `CF-Access`, `core-jp`, or
`ACCESS_CLIENT` reference. `core-jp.umaxica.app` has no A record. **A and B are therefore the only
two ways Edge traffic crosses the Tunnel.**

#### Out of scope for this inventory

- **`dev/apex`, `dev/acme`** — `umaxica.dev` is delegated to Vercel DNS, outside Cloudflare.
- **`{app,com,org}/core`** (5405/5105/5305) — no Public Hostname. `jp.umaxica.*` points at a Rails
  origin, so no path reaches the cores through ingress (ADR 007 is implemented in code but
  receives nothing).
- **Rails surfaces** — `auth`, `side-jp`, `jp`, `palm-jp`, `www` traverse the same connector but are
  the Rails repository's; Edge observes them read-only.

Reproduce (no credential, works with the origins stopped):

```bash
for h in umaxica.app info.umaxica.com help-jp.umaxica.org; do
  curl -s -o /dev/null -w "$h %{http_code} %{redirect_url}\n" "https://$h/"
done
# good = 302 to umaxica.cloudflareaccess.com/... ; anything else is bad
```

### Apex local origins in detail — 2026-08-10, from inside the development container

The four apexes were exercised first, on their own, because they are the only surfaces whose
identity is verifiable from the response body. Every request carried the production `Host` the
Tunnel will present, so this measures the same code path ingress will hit.

| Application | Port | `/health.json`               | `/` | `Location`                   | `/about` | `<title>`                       | `POST /` | `/nope` | localhost leak |
| ----------- | ---- | ---------------------------- | --- | ---------------------------- | -------- | ------------------------------- | -------- | ------- | -------------- |
| `app/apex`  | 5401 | 200 `service=app`, `env=dev` | 301 | `https://jp.umaxica.app/`    | 200      | `About \| UMAXICA (app) - Apex` | 403      | 404     | none           |
| `com/apex`  | 5101 | 200 `service=com`, `env=dev` | 301 | `https://jp.umaxica.com/`    | 200      | `About \| UMAXICA (com) - Apex` | 403      | 404     | none           |
| `org/apex`  | 5301 | 200 `service=org`, `env=dev` | 301 | `https://jp.umaxica.org/`    | 200      | `About \| UMAXICA (org) - Apex` | 403      | 404     | none           |
| `net/apex`  | 5201 | 200 `service=net`, `env=dev` | 301 | `/about` (relative, by spec) | 200      | `About \| UMAXICA (net) - Apex` | 403      | 404     | none           |

Four things this run established that the plan had only assumed:

- **`service` matches the brand on all four locally**, including `net`. The production misbinding of
  `umaxica.net` is therefore a Cloudflare-side problem, not a code one.
- **The dev response carries an `environment` field and the production Worker's does not.** That is
  a reliable discriminator for "is the Tunnel or the deployed Worker answering", available without
  adding an endpoint. Post-cutover verification uses it.
- **`POST /` is 403, not 404.** `hono/csrf` rejects before the method check, and it does so with a
  correct production `Origin` too — apex is GET-only, so this is the intended answer for every
  non-GET regardless of origin. Recorded so a future reader does not read 403 as a Tunnel fault.
- **`net/apex` sends a relative `Location: /about`.** No absolute origin is generated, so there is
  nothing to leak; a client resolves it against the external hostname. `curl` displaying
  `http://127.0.0.1:5201/about` is curl's own resolution of the relative value, not a leak.

`Location` and body were scanned for `localhost`, `127.0.0.1`, `edge-core`, `0.0.0.0`, and the
container's `10.89.` address across `/` and `/about` on all four: no match.

**Host validation is absent by design.** `Host: nonsense.invalid` on port 5401 still returns
`service=app` with 200. The applications do not inspect `Host`, so the catch-all is the only thing
that stops an unknown hostname resolving to a working application — it is a required part of the
ingress configuration, not a hardening extra.

## Cloudflare Access

The target shape, unauthenticated:

```text
external FQDN ── Cloudflare ── Access ──X   (302 to the team domain; connector never contacted)
```

and authenticated:

```text
external FQDN ── Cloudflare ── Access ── Tunnel ── edge-core:<port> ── application
```

Rails already runs exactly this, which makes it the reference to match rather than a shape to
invent. Measured 2026-08-10 from inside the development container:

| FQDN                  | Unauthenticated | Redirects to                                          |
| --------------------- | --------------- | ----------------------------------------------------- |
| `auth.umaxica.app`    | 302             | `umaxica.cloudflareaccess.com/cdn-cgi/access/login/…` |
| `www.umaxica.app`     | 302             | same                                                  |
| `core-jp.umaxica.app` | 302             | same                                                  |
| `side-jp.umaxica.app` | 302             | same                                                  |

So an Edge apex is correct when `https://umaxica.<brand>/about` returns 302 to that team domain
while unauthenticated, and the apex HTML with `service=<brand>`/`environment=development` once
authenticated. The login URL's query string carries a `meta` JWT and is `[REDACTED]` everywhere in
this repository.

Two Access specifics the apexes need:

- **`/health*` is NOT bypassed. Decided 2026-08-11, reversing the 2026-08-10 decision.** Access
  covers the whole host, health endpoints included. No path on any Edge surface answers an
  unauthenticated request.

  The superseded decision, recorded so the reasoning is not lost: on 2026-08-10 the four apex Access
  applications were to carry a Bypass for `/health`, `/health.json` and `/health.html`, because
  `service` is the only response-level proof of which brand answered, and without the bypass a brand
  mix-up — the class of failure `umaxica.net` exhibits in production — is undetectable without a
  browser. The same was extended to the three `info` applications on 2026-08-11.

  **What the reversal costs, measured rather than assumed.** With Access applied to the four apexes
  and no bypass:

  - `scripts/check-apex-domains` reports `FAIL … served by <unreachable>/apex` on all four. It
    cannot follow a login flow, so it can no longer read `service`. It is a manual diagnostic — not
    wired into CI, lefthook, or any `package.json` script — so nothing automated regressed.
  - `check:tunnel:apex` reports `acs` **ok** and everything from `orig` on **BLOCKED**. BLOCKED, not
    FAIL: the checker was built to treat a 302-to-Access as its own outcome, so the suite still
    passes. What changed is what can be proven, not whether it passes.
  - Brand correctness on the apexes is now verifiable only in a browser, or with a service token.

  **Why the cost was accepted.** The bypass is not the only way to restore machine verification — a
  service token (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`, which the checker already
  supports and prompts for) does the same without an unauthenticated path. The 2026-08-10 bypass was
  a consequence of the separate decision not to use a service token, not an independent requirement.
  Given that nothing automated depends on it, keeping the surface uniformly closed was preferred to
  opening a path on a tunnel that terminates on a developer's machine.

  **If machine verification of brand is wanted later**, use a service token rather than
  reintroducing the bypass. If the bypass is reintroduced anyway, scope it to `/health.json` alone —
  `/health` and `/health.html` are human-facing HTML and are not needed by any checker, so `/health*`
  opens more than the requirement.

- **Apex is GET-only and sets no cookie**, so there is no session interaction with the `CF_Authorization`
  cookie to verify — unlike the Rails surfaces.

### Palm

`palm-jp` has **zero references anywhere in this repository** — it is a Rails surface, and no Edge
workspace serves it. `palm-jp.umaxica.app` was measured at 302-to-Access on 2026-08-10, so
interactive Access is already applied to it by the Rails side.

Recorded here only so the absence is not read as an oversight: whether interactive Access is
appropriate for a surface a native iOS/Android client calls directly, or whether it needs service
authentication instead, is a question about Rails' authentication architecture. **Edge asserts no
opinion and Edge did not configure it.**

### Apex external baseline — 2026-08-10, `pnpm run check:tunnel:apex`

The apex-only mode run against the hostnames **before** any Cloudflare configuration. Every row is
the deployed Worker answering; the point of recording it is that the checker names that fact rather
than reporting a hollow PASS.

| FQDN          | dns | cf  | access | origin | identity                         | route                    | leak |
| ------------- | --- | --- | ------ | ------ | -------------------------------- | ------------------------ | ---- |
| `umaxica.app` | ok  | ok  | WARN   | ok     | FAIL — `environment` absent      | ok                       | ok   |
| `umaxica.com` | ok  | ok  | WARN   | ok     | FAIL — `environment` absent      | ok                       | ok   |
| `umaxica.org` | ok  | ok  | WARN   | ok     | FAIL — `environment` absent      | ok                       | ok   |
| `umaxica.net` | ok  | ok  | WARN   | ok     | FAIL — `service=app`, want `net` | FAIL — 301 to `jp.…app/` | ok   |

Reading the three failure kinds:

- **`identity` FAIL, `environment` absent, on all four** — the correct pre-cutover result. The
  deployed Worker owns the hostname, so the Tunnel is not in the path yet. This flips to PASS the
  moment the Public Hostname takes over, which makes it the cutover's own acceptance test.
- **`access` WARN on all four** — no Access application exists yet, so the hostnames are reachable
  unauthenticated. WARN rather than FAIL because the operator applies Access surface by surface;
  it must not be silent, since an unprotected development origin would be on the internet.
- **`net` FAIL on both `identity` and `route`** — `umaxica.net` is served by the `app/apex` Worker,
  so it reports `service=app` and redirects `/` to `https://jp.umaxica.app/`. Locally `net/apex`
  answers `service=net` and redirects to `/about`, so this is a Cloudflare binding defect, not a
  code one. See "Findings that need separate attention".

### After the cutover

_Sixteen of sixteen reached. Measured 2026-08-11 07:00–07:40 UTC with `pnpm run check:tunnel:apex`,
`pnpm run check:tunnel:edge`, per-hostname `curl`, and a three-round ablation for the nine frames
that carry no `/health.json`. Method and raw values are in "All sixteen verified through the
Tunnel". The four apex rows' `Application` column was measured **before** Access was applied at
08:0x UTC; it is the last machine-made reading of those four and cannot be reproduced without a
service token._

| External FQDN                   | Tunnel                       | Unauthenticated Access                          | Authenticated Access                    | Application                                                                        |
| ------------------------------- | ---------------------------- | ----------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `umaxica.app`                   | **PASS** — 200 via connector | **PASS** — 302 to the team domain on every path | BLOCKED — no service token, by decision | **PASS** (pre-Access) — `service=app`, `env=development`, `/`→301 `jp.umaxica.app` |
| `umaxica.com`                   | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — `service=com`, `env=development`                           |
| `umaxica.net`                   | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — `service=net`, `env=development`, `/`→301 `/about`         |
| `umaxica.org`                   | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — `service=org`, `env=development`                           |
| `info.umaxica.app`              | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — `service=app`, `frame=info`, `env=development`             |
| `info.umaxica.com`              | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — `service=com`, `frame=info`, `env=development`             |
| `info.umaxica.org`              | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — `service=org`, `frame=info`, `env=development`             |
| `docs-jp.umaxica.{app,com,org}` | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — frame from `UMAXICA Docs`, brand by ablation               |
| `news-jp.umaxica.{app,com,org}` | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — frame from `UMAXICA News`, brand by ablation               |
| `help-jp.umaxica.{app,com,org}` | **PASS**                     | **PASS** — 302, `/health*` included             | BLOCKED                                 | **PASS** (pre-Access) — frame from `UMAXICA Help`, brand by ablation               |

Every `Application` cell is a measured identity, not a 200, and every one is marked `(pre-Access)`:
**all sixteen** hostnames are now behind Access with no `/health*` Bypass, so none of these readings
can be reproduced without a browser or a service token. The nine `-jp` brands came from ablation
rather than from the response, which was a point-in-time result even before Access; under the
current configuration it is not repeatable at all.

`Unauthenticated Access` is PASS on all sixteen: a 302 to the team domain proves the connector was
never contacted. That is what this column exists to record, and it is the one gate here that stays
machine-checkable.

_Earlier reading, kept because it is what the record said at the time: still not run as of
2026-08-11 05:45:53 UTC; `info.umaxica.{app,com,org}` re-checked at that timestamp over
DNS-over-HTTPS returned `NOERROR` with no `A` and no `CNAME` on all three. At 06:25–06:30 UTC the
same three answered 502 and then 530 `1033` with no dev server running._

_Earlier note, unchanged. Re-confirmed 2026-08-10 13:3x UTC: none of the sixteen hostnames has an A record, so
there is nothing external to measure. The local origins were verified PASS at 13:45–13:48 UTC and
the route table was handed to the operator; this section stays empty until the Public Hostnames
exist. Record here, per FQDN: verification timestamp, tested path, expected application, HTTP
status, PASS/FAIL/BLOCKED, authentication state, application-log evidence, and notes._

_Machine verification covers the unauthenticated half only — no Access service token is used
(decided 2026-08-10). The authenticated half is confirmed by the operator in a browser and is
recorded as user-reported evidence, kept visually separate from measured rows. Gates that need
authentication are recorded **BLOCKED**, never PASS._

### Negative tests to run after the cutover

- `docs-jp` must not reach News, `news-jp` must not reach Help, `help-jp` must not reach Docs —
  checked by the frame marker in the HTML (`ident` gate).
- `docs-jp` must not redirect to `docs.jp` — check the `Location` header is absent on `/`.
- Apex brand mix-up — `/health.json` `service` must equal the brand (`ident` gate). This is the
  check that catches the class of failure a 200 cannot. **Since 2026-08-11 it needs a browser or a
  service token**: `/health*` is behind Access with no Bypass, so an unauthenticated run reports
  BLOCKED rather than performing the check. Verified once unauthenticated before Access was applied
  — all four correct — and that result is the last machine-made one.
- An unknown Host must get the catch-all 404, not a working application.
- `{app,com,org}/core`, 8976, and the inspector ports must remain unreachable from the internet.
- Core must be unaffected. Compare against the **2026-08-10 13:3x DNS state**, not the earlier
  baseline: `jp.umaxica.{app,com,org}` still 302-to-Access and still not pointed at any Edge port,
  `side-jp` still 302-to-Access, `core-jp.umaxica.app` still without a record.
- The Workers VPC path must be unaffected: `UMAXICA_APPS_EDGE_CF_WORKERS_VPC` still declared only
  under `env.vpc`, and `/rails-health` still 503 `not-configured` under `next dev`. A Tunnel route
  is not a Workers binding.
- `.app` must not reach the `.com` application and `.com` must not reach `.org` — for the apexes
  and for the three `info` frames this is the `/health.json` `service` field. For the remaining nine
  frames it is not decidable from the response; decide it by ablation instead — stop one brand's
  three dev servers and confirm exactly that brand's three hostnames return 502 while the other six
  stay 200. Done for all three brands on 2026-08-11.
- Unauthenticated must not reach the origin. `Host` validation is absent in the applications, so
  this is an Access/ingress property only — verify it as a 302 to the team domain, and confirm the
  dev-server log recorded no request for that attempt.
- `environment=development` must be present in every apex `/health.json`. Its absence means the
  deployed Worker, not the Tunnel, answered — a pass that would otherwise look identical.

## Known limitations

- **The work is complete.** As of 2026-08-11 08:2x UTC all sixteen routes exist, all sixteen were
  verified end to end, and all sixteen are behind Access. Steps 1–4 and 6 are done and measured; the
  catch-all 404 and the Cache Rule were examined and declined, with reasons, under "State of those
  six steps". `adr/008-edge-development-tunnel-exposure.md` carries the closeout and the general
  rule the work produced.
- **Nothing is machine-verifiable behind Access any more, by design.** `/health*` is not bypassed
  (decided 2026-08-11), so every surface answers an identical 302 regardless of which application,
  which port, or whether anything is listening. `scripts/check-apex-domains` reports `<unreachable>`
  on all four apexes; the checker's post-Access gates are BLOCKED on all sixteen. The
  `service`/`frame` literals still exist and still work — they need a browser or a service token to
  read. This is an accepted cost; see "Cloudflare Access".
- **Ablation no longer works either.** Deciding a `-jp` frame's brand by stopping one brand's dev
  servers and watching which hostnames 502 requires requests to reach the origin. The nine mappings
  fixed on 2026-08-11 stand, but re-verifying after a future ingress edit needs Access removed
  temporarily or a service token.
- **All identity evidence in this document predates 08:2x UTC.** The apexes' `service`, the `info`
  frames' `service`/`frame`, and the nine `-jp` frames' ablation were each measured while their
  surface was still unauthenticated. They are correct as recorded and none can be reproduced under
  the current configuration without a credential.
- **Only the ingress half of the Tunnel is measured.** Edge crosses the Tunnel two ways: browser →
  Tunnel → Edge (sixteen Public Hostnames, verified refused unauthenticated on 2026-08-11) and Edge
  Worker → VPC Service → Tunnel → Rails (the fifteen Rails-backed frames). **The egress path has not
  been exercised since Access was applied** — it needs `pnpm preview:vpc` and an interactive
  `wrangler login`. It carries no Access by design (ADR 006), so nothing about it should change, but
  that is a design statement rather than a measurement.
- **Eight production surfaces are replaced by the development Tunnel** — the four apex hostnames,
  `docs-jp.umaxica.com`, `news-jp.umaxica.com`, `news-jp.umaxica.org`, `help-jp.umaxica.org`. This
  is an authorized cutover, not an accident. All eight now resolve and answer through the Tunnel;
  while the development machine, the container, or a given dev server is down they return a
  Cloudflare 502. That is a live 502 on production hostnames, not a quiet absence.
- **The authenticated half is not machine-verified.** No Access service token is used, by decision.
  Authenticated results come from the operator's browser and are recorded as such; the checker's
  post-Access gates report BLOCKED rather than PASS.
- **Brand mix-up is verifiable on the three `info` frames and still unverifiable on the other
  nine.** All three brands of a frame return byte-identical HTML — same `<title>`, same `eyebrow`,
  no `metadataBase`, no `NEXT_PUBLIC_*` — so the page itself cannot say which brand answered.
  `{app,com,org}/info` now carry `/health.json` with build-time `service`/`frame` literals, which
  closes it for those three (added 2026-08-11; ADR 008 had recorded the endpoint as deliberately
  not done). `docs`, `news` and `help` do not have the route yet, so the `ident` gate still reports
  **WARN** for them rather than a PASS that would look like a brand check it never ran.

  Their brand no longer rests on the ingress table alone, though: the 2026-08-11 ablation
  (stop one brand's servers, observe which hostnames 502) decided all nine from outside. That is a
  **point-in-time measurement, not a continuous check** — it has to be repeated by hand after every
  ingress edit, and nothing fails if someone forgets. Adding `/health.json` to the nine is what
  would make it continuous.

- **Core is not covered.** `jp.umaxica.{app,com,org}` needs path-level ingress and is a separate
  piece of work.
- **Production is out of scope.** This is the development tunnel only; there is no production
  tunnel or production VPC Service.
- **A Tunnel route is not a Workers binding.** `/rails-health` answering 503 `not-configured` is
  the correct development answer, not a Tunnel failure. Only `pnpm preview:vpc` exercises the VPC
  path.
- **`apex` `routes` must stay empty.** `{app,com,org,net}/apex/wrangler.jsonc` now declares
  `"routes": []` at the top level. Restoring an apex domain to its Worker means removing the
  Tunnel's Public Hostname first, then putting the `routes` entry back — in that order.

## Known exclusions

Deliberately outside this work, so that "not verified" is never mistaken for "verified and fine":

- **Production deployment.** No production Tunnel, no production VPC Service, no production Access
  policy. Production is being rebuilt separately, using development as the reference implementation.
- **Core shared-FQDN routing.** `jp.umaxica.{app,com,org}` needs path-level ingress splitting Rails
  and the frame (ADR 007) and is a separate piece of work. `core-jp.*` is deliberately not
  reintroduced as a canonical hostname. Nothing here points a Core hostname at an Edge port.

  As of 2026-08-11 the Public Hostname for each of the three sends the **whole** FQDN to a Rails
  origin (`http://core.<brand>.localhost:3000`). ADR 007 is implemented in code —
  `{app,com,org}/core/src/lib/core-dispatch.ts` — but receives no request through ingress, because
  no path is routed to an Edge port. Recorded so that "ADR 007: Implemented" is not read as "the
  shared FQDN is live".

- **The Workers VPC transport.** `frame → Workers VPC → Rails` is a different graph and is
  untouched; a Tunnel route neither creates nor replaces a Workers binding.
- **`dev/apex`.** `umaxica.dev` is still delegated to Vercel DNS, outside the Cloudflare
  boundary, so the unit binds container loopback only even though it now deploys to Workers.
- **The Rails surfaces.** `auth`, `side-jp`, `palm-jp`, `www`, and the Rails connector itself are
  the Rails repository's; Edge measured them read-only and configured none of them.

  Their Public Hostname entries, read off the dashboard on 2026-08-11, are recorded here only
  because one detail of them corroborates an Edge assumption:

  | FQDN                            | Origin                               |
  | ------------------------------- | ------------------------------------ |
  | `auth.umaxica.{app,com,org}`    | `http://auth.<brand>.localhost:3000` |
  | `side-jp.umaxica.{app,com,org}` | `http://side.<brand>.localhost:3000` |
  | `jp.umaxica.{app,com,org}`      | `http://core.<brand>.localhost:3000` |
  | `www.umaxica.{app,com,org}`     | `http://base.<brand>.localhost:3000` |
  | `palm-jp.umaxica.app`           | `http://palm.app.localhost:3000`     |

  The origins follow `http://<frame>.<brand>.localhost:3000` — the same scheme as
  `PRIVATE_RAILS_ORIGIN` in each `<brand>/<frame>/src/lib/rails-client.ts`. That is independent
  confirmation of ADR 006's amendment ("fifteen Rails entry points, still one VPC Service"): the
  Host-based dispatch Edge relies on is how the Rails side is actually wired, not only how Edge
  believes it is. Rails' own frame names in that scheme are `auth`, `side`, `core`, `palm`, and
  `base` (= `www`); `palm-jp` exists on `.app` alone, and `core-jp.*` does not appear at all —
  both consistent with the DNS state recorded above. **Edge configured none of these and asserts
  nothing about whether they are correct.**

## Findings that need separate attention

**`umaxica.net` is bound to the wrong Worker in production.** `https://umaxica.net/health.json`
answers `{"service":"app"}` and `/about` renders `About | UMAXICA (app) - Apex`; the `net/apex`
Worker never sees the request. This is the same incident ADR 003 records, still live, and
`scripts/check-apex-domains` — written for exactly this — fails on it today.

The Tunnel cutover masks the symptom, because `umaxica.net` will then reach `edge-core:5201` =
`net/apex`. **The production misbinding itself is untouched and will reappear the moment the
hostname goes back to Workers.** Fix it in the dashboard independently of this work.

**The deployed content Workers are stale.** `/rails-health` returns Next's 404 page on all four
live `-jp` hostnames, so the deployed build predates that Route Handler. Redeploy before relying on
those hostnames as production again.

## Related

- `docs/development/cloudflare-development-network.md` — the independent private-Podman,
  Access/Tunnel, development-VPC, and production-VPC paths
- `docs/operations/cloudflare-access.md` — Access validation
- `docs/operations/connectivity-acceptance.md` — the apex hostname/Worker acceptance table
- `adr/008-edge-development-tunnel-exposure.md` — the decision recorded here, and what it amends
