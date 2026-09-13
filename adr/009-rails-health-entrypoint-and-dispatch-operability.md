# ADR 009: One health entry point, and an operable Rails dispatch

## Status: Implemented — decision 3 amended by [ADR 016](016-rails-machine-health-api.md)

Edge still owns a single public `/health` entry point (this record). The Rails
upstream path is no longer `/health/liveness.json`; it is
`GET /api/v0/health.json`. Historical measurements below are unchanged.

## Context

The Workers VPC connection between Rails and Edge worked (ADR 005/006) and the
shared-FQDN dispatch that uses it worked (ADR 007). Neither was operable. Four
things were wrong, and the first is the one the others hang off.

**1. Rails' health surface and Edge's did not line up.** Rails serves `/health`,
`/health/liveness`, `/health/readiness` and `/health/startup`. Edge reached
exactly one of them — `liveness` — through a separate route, `/rails-health`, and
its own `/health` reported only Edge. So there were two entry points, each
answering half the question, and neither could answer "is this surface serving?".
Worse, `/health` meant something different on each side of a shared FQDN, while
`core-dispatch.ts` blocks `/health/*` at the edge and therefore left Rails' health
namespace unreachable through the public hostname entirely. The name matched; the
meaning did not.

**2. The route ownership table was triplicated and unguarded.** `classifyCorePath`
lives in three `*/core/src/lib/core-dispatch.ts` copies. Each Core tested its own
copy against its own table, which is exactly the arrangement that lets three
tables drift with three implementations. Nothing in the repository-level suite
mentioned `core-dispatch` at all. The tests had in fact already drifted: one Core
asserted five stripped forwarding headers and four preserved application headers,
the other two checked two headers and asserted no preservation — a weaker gate on
identical code.

**3. `dispatchToRails()` had no failure handling.** It was
`return binding.fetch(railsRequest)`: no timeout, no `catch`. And the failure it
most needed to handle is not the one an author would guess. `rails-client.ts`
lines 169-185 record a measurement from 2026-08-09, taken by stopping Rails:

> Workers VPC does not throw when the private origin is unreachable. It answers
> with an ordinary HTTP 500 whose body carries the documented code:
> `500 text/plain "ProxyError: connection_refused"`

`rails-client.ts` claims that and reports `unreachable`. `dispatchToRails()`
passed it through, so a stopped Rails reached the browser as a Rails-authored 500,
indistinguishable from Rails returning 500 from its own code — and equally
indistinguishable in any log.

**4. Nothing was observable, and one thing leaked.** `{app,com,org}/core/src`
contained zero `console.*` calls, so every failure path above was silent. Meanwhile
the public health DTO carried `errorMessage`, populated from `rails-client.ts`'s
`getErrorMessage(error)` — an arbitrary exception string on a public endpoint.
Today's values are Cloudflare's fixed `ProxyError:` vocabulary, so nothing had
leaked yet; the channel existed regardless.

## Decisions

### 1. `/health` is the single health entry point, on all fifteen frames

`/health` answers for both halves in one document:

```json
{
  "status": "ok",
  "timestamp": "2026-08-12T00:00:00.000Z",
  "edge": {
    "status": "ok",
    "version": { "id": "…", "tag": "…", "timestamp": "…" }
  },
  "rails": { "liveness": { "kind": "ok", "status": 200 } }
}
```

`/rails-health` is **deleted** from all fifteen frames, along with its per-frame
test. `test/rails-connection-invariants.test.ts` asserts it absent, next to the
existing assertion against the HTML status page that preceded it.

The fifteen `/health` copies were two groups before this: the three Cores read the
`REVISION` binding and answered 503 on failure, the twelve content frames returned
a static `{"status":"ok"}` from a synchronous `GET` with no `connection()` call —
i.e. prerendered at build time. They are now one byte-identical implementation,
pinned as such. The twelve content frames therefore become dynamic; that is a real
change and is listed under Consequences.

`status` is kept at the top level so `tools/verify-edge-connectivity.mjs`'s
existing `status === 'ok'` check keeps meaning what it meant.

### 2. HTTP 503 when either half is down — reversing ADR 007's position

This **reverses** the position held while ADR 007 was written, and stated in this
task's own brief: "Edge's own `/health` and Rails' `/rails-health` must not mix
meanings" and "a Rails outage must not make Edge `/health` unhealthy". The
instruction to merge them supersedes it, knowingly.

The reversal has a consequence that has to be read before deploying, not after:

**Production `/health` answers 503 on all fifteen frames until a production VPC
Service exists.** The top level of every `wrangler.jsonc` — which _is_ production;
there is no `env.production` — carries no `vpc_services`, because the only VPC
Service that exists is on the development tunnel and terminates on a developer's
machine (ADR 006 §1, ADR 007's tier table, asserted by
`test/rails-connection-invariants.test.ts`). So `getRailsClient()` returns `null`,
the Rails half is `not-configured`, and `not-configured` counts as down.

Counting it as down was chosen deliberately, on the stated premise that production
will get a VPC Service. The alternative — treating "no transport" as "not a
failure" — would have made the unfinished half of the connection invisible at
exactly the surface built to show it. But it means: **create the production VPC
Service before pointing a load balancer, an uptime check or a Cloudflare health
check at `/health`.** The restoration procedure is unchanged from ADR 006/007 —
a production tunnel, a production VPC Service, then the same `vpc_services` block
at the top level, with no application code change. The comment at each
`wrangler.jsonc`'s top-level block now says so.

What the merge does **not** do is let one half hide the other. The Rails probe is
resolved before the block that can throw, and both halves are always serialized,
so an operator reading a 503 can always see which half failed. `test/health-route.test.ts`
covers it; `test/core-dispatch-contract.test.ts` pins the structure.

### 3. Liveness alone, not three probes

`/health` probes `/health/liveness.json` and nothing else. Liveness is the
strictest of Rails' three, so it is the one that decides, and `/health` is the
most-polled route in the repository — every added probe multiplies tunnel traffic
by fifteen frames. Readiness and startup exist on the Rails side and are
deliberately not read.

`RAILS_LIVENESS_PATH` is a single constant and `RailsHealthReport` already reports
per probe, so widening this is a local change. It is pinned closed
(`test/rails-connection-invariants.test.ts` asserts `readiness.json` and
`startup.json` do not appear) so that widening is a decision rather than a drift.

**Their existence is unverified.** See "What could not be verified".

### 4. Each frame already reaches its own Rails entry point — verified, not changed

The brief asked for `info.umaxica.org` to read `org`'s `info` health rather than a
shared endpoint. It already does, and no code changed for this.

The path is identical in all fifteen frames; the **`Host` header** is what differs
and what Rails dispatches on, to `<Frame>::<Brand>::…`. `PRIVATE_RAILS_ORIGIN` in
each `rails-client.ts` supplies it:

| Public FQDN        | Frame      | `PRIVATE_RAILS_ORIGIN`           | Rails namespace |
| ------------------ | ---------- | -------------------------------- | --------------- |
| `jp.umaxica.app`   | `app/core` | `http://core.app.localhost:3000` | `Core::App::…`  |
| `info.umaxica.app` | `app/info` | `http://info.app.localhost:3000` | `Info::App::…`  |
| `docs.umaxica.app` | `app/docs` | `http://docs.app.localhost:3000` | `Docs::App::…`  |
| `news.umaxica.app` | `app/news` | `http://news.app.localhost:3000` | `News::App::…`  |
| `help.umaxica.app` | `app/help` | `http://help.app.localhost:3000` | `Help::App::…`  |
| `jp.umaxica.com`   | `com/core` | `http://core.com.localhost:3000` | `Core::Com::…`  |
| `info.umaxica.com` | `com/info` | `http://info.com.localhost:3000` | `Info::Com::…`  |
| `docs.umaxica.com` | `com/docs` | `http://docs.com.localhost:3000` | `Docs::Com::…`  |
| `news.umaxica.com` | `com/news` | `http://news.com.localhost:3000` | `News::Com::…`  |
| `help.umaxica.com` | `com/help` | `http://help.com.localhost:3000` | `Help::Com::…`  |
| `jp.umaxica.org`   | `org/core` | `http://core.org.localhost:3000` | `Core::Org::…`  |
| `info.umaxica.org` | `org/info` | `http://info.org.localhost:3000` | `Info::Org::…`  |
| `docs.umaxica.org` | `org/docs` | `http://docs.org.localhost:3000` | `Docs::Org::…`  |
| `news.umaxica.org` | `org/news` | `http://news.org.localhost:3000` | `News::Org::…`  |
| `help.umaxica.org` | `org/help` | `http://help.org.localhost:3000` | `Help::Org::…`  |

Two measured facts sit behind this. Workers VPC does not route on the host — one
Service and one tunnel serve all fifteen — so the host reaches Rails as the `Host`
header and nothing else; measured 2026-08-10, `docs.app.localhost` answering from
`Docs::App::Health::LivenessesController` and `core.com.localhost` from
`Core::Com::…`. And the path carries no frame prefix, because it once did and Rails
answered `ActionController::RoutingError (No route matches [GET]
"/docs/app/health/liveness.json")` — ADR 006 §4 retracted the prefix.

A wrong host here does not fail loudly: it reaches the wrong namespace and answers 200. That is why `test/rails-connection-invariants.test.ts` pins all fifteen
individually rather than asserting they agree.

### 5. Intentional Edge overrides of paths Rails also serves

The ownership table came from an audit of Rails' `config/routes/core.rb`, which
this repository cannot read. ADR 007 said so and asked for reconciliation. This
record reconciles it against the supplied Rails route list, and the outcome is that
five rows where both sides have a route are **kept as they are, on purpose**:

| Path             | Rails                        | Edge                 | Why                                                                                                   |
| ---------------- | ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `/health/*`      | liveness, readiness, startup | **BLOCKED**          | A Rails-internal health namespace does not belong on the public FQDN. Diagnostics are `/health`'s job |
| `/health`        | serves it                    | **NEXT**             | This is the unified entry point of decision 1                                                         |
| `/robots.txt`    | serves it                    | **NEXT**             | Edge owns the crawler contract for the public FQDN (`src/app/robots.ts`)                              |
| `/sitemap.xml`   | serves it                    | **NEXT**             | Same (`src/app/sitemap.ts`)                                                                           |
| `/configuration` | serves it, for `org`         | **NEXT** (unchanged) | **Known collision.** Recorded, not resolved                                                           |

`/configuration` amends ADR 007 lines 69-71, which read "no evidence of a
difference" — there is now evidence that `org` has a Rails route at this path too.
Ownership is deliberately not reassigned here: deciding it needs the two sides
compared, which needs the Rails repository. Until then Edge serves it, as it
already did.

`/health` vs `/health/*` works because BLOCKED is a raw
`startsWith('/health/')` rather than the `matchesPrefix()` helper the Rails
prefixes use. That asymmetry was already there; it is now the load-bearing reason
a unified health entry point is possible, and is commented as such.

### 6. Four VPC failure modes, one 503, no fallback

`dispatchToRails()` now distinguishes:

| Condition                                                   | Response        | Log outcome                     |
| ----------------------------------------------------------- | --------------- | ------------------------------- |
| binding absent                                              | 503             | `binding_not_configured`        |
| `binding.fetch()` rejects with `TimeoutError`/`AbortError`  | 503             | `timeout`                       |
| `binding.fetch()` rejects otherwise                         | 503             | `vpc_unreachable`               |
| 500 + `text/plain` + body matching `/^ProxyError:\s*(\w+)/` | 503             | `vpc_unreachable`               |
| anything else Rails answered                                | **passthrough** | `rails_ok` / `rails_http_error` |

Claiming the `ProxyError` 500 is the substantive change: it is not a Rails
response, so returning it as one was wrong, and ADR 007's "return Rails' response
unchanged" is intact rather than weakened. The detection is a private copy of
`rails-client.ts`'s `readProxyError()` — per `CLAUDE.md`, a copy, not a shared
module — narrowed to return only the code. It reads a **clone**, bounded to 200
bytes, on the error path only; the success path never touches the body.

Held constant on purpose: no retry, for mutations as much as reads (a retried POST
that timed out is a second mutation, not a second chance); no fallback to Next.js
on any failure path; `Cache-Control: no-store, no-cache, must-revalidate` on every
503; no request-body buffering (`request.body` stays a stream, `duplex: 'half'`);
and the Cookie/CSRF/`Origin`/`Referer` forwarding and `x-forwarded-*` stripping
exactly as ADR 007 left them.

Timeout is 5000 ms, matching `rails-client.ts`'s `RAILS_FETCH_TIMEOUT_MS` — one
Rails timeout budget per frame regardless of direction, pinned equal by
`test/core-dispatch-contract.test.ts`.

It is carried on the `Request` rather than passed as `binding.fetch(request,
{signal})`. Both are supported — Cloudflare's Workers VPC binding API documents
`signal` in the options object — but an options object makes the runtime rebuild
the Request, and rebuilding one whose body is a half-duplex stream is precisely
what this dispatch must not do. (The workerd bug that made
`AbortSignal.timeout()` rejections uncatchable, cloudflare/workerd#1020, is fixed
by #1177; `rails-client.ts` has been relying on that in production already.)

Cloudflare documents `fetch()` throwing for `bad_upstream`
(`connection_refused`, `connection_timeout`, `dns_error`,
`tls_certificate_error`), client (`dns_error` NXDOMAIN,
`connection_read_timeout`, `rate_limited`) and internal
(`proxy_internal_error`). That does not contradict the measured 500 — both are
handled, because both are documented behaviour by different sources and neither
can be assumed exclusive.

### 7. Privacy enforced by the type, not by the caller

`src/lib/rails-dispatch-log.ts` (three Cores, byte-identical) emits one JSON line
per dispatch in the `{ level, msg, data }` envelope each apex worker's
`structured-logger.ts` already produces, so both worker classes read alike in
Workers Logs. That module is not reusable here — it is `@hono/structured-logger`
middleware and a Core frame is a bare Workers `fetch` handler — but the shape is.
`observability.logs.enabled` already collects `console.*`; no new binding, no new
vendor.

Fields: `event`, `ownership`, `method`, `route_class`, `outcome`, `duration_ms`,
and `upstream_status` / `proxy_error_code` only when they exist.

`RailsDispatchLogEntry` is a closed interface with **no free-text field**. Every
value is a number or a member of a fixed union: `route_class` is one of eight,
`outcome` one of five, `method` a standard verb or `OTHER`, `proxy_error_code` one
of Cloudflare's documented codes or `unknown`. There is therefore no channel
through which a raw Cookie, an `Authorization` header, a CSRF token, a request or
response body, a query string, a user id, an email, an access token, an internal
hostname or a VPC service id can reach a log line — not by mistake at a future
call site either. The raw pathname is never recorded: `classifyRailsRouteClass()`
reduces it first, so a path carrying an identifier cannot leak through the label.

`rails-dispatch-log.ts` holds its own copy of the route table, because
`core-dispatch.ts` imports it and sharing the constants would make them circular.
`test/core-dispatch-contract.test.ts` asserts the two agree: every Rails-owned path
in the contract must classify as something other than `other`, and no non-Rails
path may claim a Rails class.

### 8. `errorMessage` removed from the public shape

`RailsProbeReport` carries `kind`, and `status` only when an HTTP status actually
existed. `rails-client.ts` keeps `errorMessage` internally — it is unchanged — but
nothing serializes it. Pinned by `test/rails-connection-invariants.test.ts`
against both files that build a response, reading them with comments stripped so
the files can explain the invariant by naming it.

> **Amended 2026-08-29.** As originally recorded this section read "`kind`,
> `latency_ms`, and `status`", and the sample document above carried
> `"latency_ms": 12`. `latency_ms` has since been removed from
> `RailsProbeReport` as well, on the same reasoning one step further: `/health`
> is unauthenticated by design, so a timing measurement of the private
> edge-to-Rails hop was published continuously to anyone who asked. A health
> check's callers need the outcome, not the hop's behaviour under load. Timing
> is recoverable from Workers Logs. The public vocabulary is now `kind` plus an
> optional `status`, and `test/lib/rails-health.test.ts` asserts no timing field
> appears in any outcome. `parseRailsHealthJson` in
> `tools/verify-edge-connectivity.mjs` only ever read `kind`, so no gate
> changed.

## What could not be verified

**The Rails repository is not on this machine.** A search of `/` found exactly one
`.rb` file (Neovim's Ruby provider) and one `.git` directory
(`/home/edge/workspace`, remote `seahal/umaxica-app-edge`). `config/routes/core.rb`
could not be read, so the route list this record reconciles against is the one
supplied to the mission, not a verified match. Resolve with `bin/rails routes` from
the Rails repository.

Two things rest on that and should be checked when it is possible:

- **`/health/readiness.json` and `/health/startup.json`** are stated to exist. Edge
  has no evidence of either and does not call them, so nothing depends on the
  answer today — but decision 3 would be reconsidered differently if they do not
  exist.
- **`/configuration` on the Rails side** is stated to exist for `org`. The
  collision is recorded on that basis.

## Consequences

- **Production `/health` is 503 on fifteen frames until a production VPC Service
  exists.** Decision 2. This is the one that can bite an uptime check.
- **The twelve content frames' `/health` becomes dynamic.** It was a prerendered
  synchronous handler; it now awaits `connection()` and makes a VPC round trip per
  request. Anything polling `/health` frequently now generates tunnel traffic from
  twelve more frames than before.
- **A stale deployed Worker is now visible rather than blessed.**
  `parseRailsHealthJson()` reads `rails.liveness.kind` and returns null for the
  pre-merge `rails.kind` shape, which is asserted. ADR 008 already records deployed
  content Workers answering 404 on `/rails-health`; the asymmetry is now the other
  way round, and the connectivity checker reports it instead of passing.
- **`tools/verify-edge-connectivity.mjs` makes one request per frame where it made
  two.** `/health` and `/rails-health` collapsed into `/health`; the Rails-touching
  request count per run is unchanged.
- **The three Cores are one implementation again, tests included.** The
  `core-dispatch.test.ts` / `worker.test.ts` drift is closed and pinned, so the
  weaker two Cores cannot silently reappear.
- **ADR 007 lines 69-71 are amended** on `/configuration`, and its "reconcile
  against Rails when that file is available" note is partially discharged: the
  reconciliation happened against a supplied list, and the file is still unread.
- ADR 005 §4 ("Health is per-frame, at `/rails-health`") and ADR 006's
  `curl 127.0.0.1:8787/rails-health` walkthrough are now historical. They are left
  as written, per this repository's practice of not rewriting what a record
  decided at the time; this document is the pointer forward.
  `docs/design/rails-health-page.md` and
  `docs/operations/cloudflare-tunnel-development.md` carry status notes, and the
  latter's recorded measurement tables are deliberately not rewritten.

## Guardrails

- `test/core-dispatch-contract.test.ts` (new) — the ownership contract held once
  and executed against all three Cores, the five documented overrides, the
  `/health` vs `/health/*` asymmetry, `core-dispatch.ts` / `worker.ts` /
  `rails-dispatch-log.ts` / both dispatch test files identical across brands, each
  Core's own public hostname, the dispatch/client timeout equality, and the log
  route classes agreeing with the ownership table.
- `test/rails-connection-invariants.test.ts` — `/health` present and identical
  across fifteen, `/rails-health` and its page absent, `rails-health.ts` identical
  across fifteen, one probe path, no `errorMessage`, plus everything it asserted
  before.
- `test/health-route.test.ts` (new, ×15, byte-identical) — both halves ok, each
  Rails failure kind, Edge-half failure with the Rails half still reported, the
  timestamp fallbacks, and six leak markers driven through four upstream shapes.
- `<brand>/core/test/core-dispatch.test.ts` (×3) — the ownership table, header
  handling, the abort signal, streamed bodies, passthrough for 200/201/302/404/405/422/500,
  all four failure modes, no-retry, and the 503 body carrying no internal text.
- `<brand>/core/test/lib/rails-dispatch-log.test.ts` (×3) — the five outcomes, the
  class and code and method vocabularies, the exact emitted key set, and every
  forbidden marker driven through four dispatch shapes.
- `<brand>/*/test/lib/rails-health.test.ts` (×15) — the probe path, the four kinds,
  and that seven leak markers survive none of the four client results.

## Outcome

**Implemented** across all fifteen frames.

`pnpm run format:check`, `pnpm run lint:check`, `pnpm run typecheck`,
`pnpm run test`, `pnpm run check:workers` and `pnpm run knip` all pass.
Per-unit coverage is 100% of statements, branches, functions and lines in every
frame checked, against each unit's 99% threshold.

`pnpm run build` also passes, all twenty units, exit 0 with fifteen OpenNext
bundles produced. **This corrects ADR 007's Outcome**, which records the build as
unexercisable here for want of a Cloudflare credential; it is exercisable, and was
exercised. Two things were read off the build output rather than inferred:
`/health` is listed as `ƒ (Dynamic)` in all fifteen frames — confirming the twelve
content frames are no longer prerendered — and `/rails-health` appears in no route
table.

The `AbortSignal`-on-`Request` behaviour is asserted under undici and not yet
measured under workerd against a real VPC binding; that needs
`pnpm --filter umaxica-apps-edge-app-core run preview:vpc`, which requires
`wrangler login`. If it turns out not to be honoured there, the fallback is
`binding.fetch(railsRequest, { signal })`, which needs its own check against a
streamed request body.
