# ADR 015: The twelve public content surfaces run Astro, partially superseding ADR 013

## Status: Accepted 2026-09-02 — framework cutover is in tree. Publishing pages (2026-09-10): Rails-backed Astro SSR over Workers VPC is in all twelve units. Collection pagination (2026-09-10): public `?page=N` is forwarded to Rails Pagy as `GET /api/v0/entries?locale={lang}&page=N`. The earlier cursor/`next_cursor`/`has_more` publishing collection contract is superseded for these surfaces. Remaining work: `plans/astro-content-surfaces-remaining.md` (Content Collections, ETag/304, three-stream sitemap, Phase 2 cache).

`{app,com,org}/{docs,help,info,news}` — twelve deployment units — move from
TanStack Start to **Astro on Cloudflare Workers**, `output: 'static'` with a
small number of on-demand routes. `{app,com,org}/core` stay on TanStack Start;
`{app,com,net,org,dev}/apex` stay on Hono (`adr/011`). One estate, three
frameworks, one per archetype.

This is the record `adr/013-frames-tanstack-start.md` invited: _"`adr/004`
rejected an earlier framework move for the twelve content frames and invited the
question to be reopened 'as a new record, with a new number'."_ It is **not** a
rewrite of `adr/004`, which stays `Rejected` as history — its constraint that an
Astro surface may consume "only public, read-only content APIs" is carried
forward here, not reversed. It **partially supersedes `adr/013`**: for these
twelve units the framework, the bundler-owned build, `defaultRenderHandler`, the
committed `routeTree.gen.ts` and the "no `prerender`" sub-decision no longer
apply. Everything `adr/013` says about the three Cores and the shared VPC / Rails
contract still holds.

`adr/013`'s own decision section and `docs/public-information-surfaces.md` carry
status notes pointing here.

## Context

The twelve units are, by measurement, **read-only content sites**: three static
pages each (`/`, `/about`, `/offline`), all copy inline, no data fetch on any
page, no loaders, no `createServerFn`, no `@tanstack/react-query` (not even a
dependency), no mutation, no auth. Yet every HTML response is a per-request React
SSR that ships ~101 kB gzip of client JavaScript to hydrate a router nothing
navigates. The only Rails touch on any of the twelve is `/health`'s liveness
probe (`adr/009`).

Two requirements landed that the current stack has no first-class answer for:

- **Rails-managed document bodies.** `docs` / `help` / `news` content will move
  into Rails as durable authority and be composed into the **first HTML** at
  request time — not lazy-fetched after load. Astro's SSR + Content Collections
  are built for exactly this shape; TanStack Router is not.
- **Language in the URL, region not.** Astro's locale routing needs a real
  `ja` / `en` prefix (`prefixDefaultLocale: true`). That is a **deliberate
  change** from the old unprefixed `defaultLocale = 'ja'` pages: content URLs
  are `/ja/…` and `/en/…`. Region (`jp` / `us`) is **not** a path segment —
  there is no `/jp/` — it is a build-time `PUBLIC_REGION` that selects the
  canonical origin (`docs-jp` vs `docs-us`). Astro owns `<html lang>`,
  canonical, `alternate`, `hreflang`; it does not own a region router.

`adr/004` was rejected because (a) `/health`'s private-VPC probe did not fit its
"public read-only APIs only" rule, and (b) "splitting three of the five roles
onto a second framework would break [the byte-identity pin] in exchange for
benefits nobody had measured." Both are now answerable: `/health` is an on-demand
Astro route that uses the same VPC binding (a health probe is a separate
responsibility from document fetch — it is not a generic proxy); and the
benefits are measured below.

## Decision

### Framework and responsibility split

| Layer                  | Units                                      | Framework      | Responsibility                                                                |
| ---------------------- | ------------------------------------------ | -------------- | ----------------------------------------------------------------------------- |
| Public content surface | `{app,com,org}/{docs,help,info,news}` (12) | **Astro**      | routing, presentation, SSR, HTML generation, SEO, locale URL (`/ja/`, `/en/`) |
| Application core       | `{app,com,org}/core` (3)                   | TanStack Start | RP/BFF, authenticated UI, session material                                    |
| Apex                   | `{app,com,net,org,dev}/apex` (5)           | Hono           | edge middleware, redirects, `/about`, `/health`                               |

- **Rails** = durable content authority, policy, public read API.
- **Astro** = compile-time + request-time presentation. **Not** an RP/BFF. A
  public Astro surface must not handle a refresh token, an authenticated
  mutation, a user-scoped secret, browser session forwarding, or a generic Rails
  proxy route. `Set-Cookie` and arbitrary upstream headers from Rails are never
  forwarded to the browser.
- **Cloudflare Workers VPC** = the private Astro → Rails transport. Binding name
  `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`, unchanged.
- **Cloudflare Workers Cache** = a Phase 2 optimisation, not a correctness
  dependency (see _Caching_).
- **Astro Islands** = interaction only. Indexable body text is never generated by
  a browser-side fetch.

### Rails-managed documents are SSR'd into the first HTML

```
Browser → Astro SSR Worker → Workers VPC → Rails public read API
        → runtime validation (Zod) → Astro components → complete HTML → Browser DOM
```

The first HTML always carries: `<title>`, headings, main content, meta
description, `<link rel="canonical">`, `hreflang` alternates, indexable metadata.
Astro never learns about S3 buckets, object keys or storage topology — it sees a
**document representation** only. Invalid upstream responses are never rendered:
they map to a `5xx` with `result class = invalid-contract`.

### Markdown via Content Collections, shared with Rails documents

Git-managed documents are Astro Content Collections
(`src/content.config.ts`, `src/content/<collection>/<locale>/**/*.md`,
`src/schemas/*.ts`), frontmatter Zod-validated, invalid authoring a **build
failure**. Markdown (`render()`) and Rails JSON (a mapper) both feed **one**
`DocumentShell` / `DocumentLayout` — no double UI. MDX is not adopted until a
Markdown body actually needs component execution.

### i18n / region — explicit change from a path-shaped `region × language` URL

An earlier grill-me draft treated region as a routing concern next to language
(`locale routing` and `region routing` in the same URL). **That is rejected.**
The two axes are different kinds of input, and mixing them in the path
(`/jp/ja/…`) is not how these hosts work today (`docs-jp.umaxica.app` vs
`docs-us.umaxica.app`).

- **Language (`ja` / `en`) is in the URL.** Astro i18n requires a locale
  prefix; both locales are prefixed (`prefixDefaultLocale: true`) and there is
  no unprefixed default page. This is the one URL change we accept because the
  framework needs it: `/ja/…`, `/en/…`. `<html lang>` always equals the routed
  locale (unlike the apex units — `adr/011`). `/` negotiates `Accept-Language`
  and `302`s to `/ja/` or `/en/`. `x-default` → `ja`.
- **Region (`jp` / `us`) is not in the URL.** No `/jp/` segment. Region is a
  build-time `PUBLIC_REGION` that selects the canonical origin. One build per
  region. The ops choice between one Worker on two custom domains and two
  deployments is deferred.
- `alternate` / `hreflang` list only **language** variants that actually exist
  for a document. Cross-region alternates, if they appear, are absolute URLs on
  the other region's origin — not a path prefix on this host.
- The absolute canonical URL is decided by **Astro**, not Rails: Astro knows the
  TLD, locale, region (via `PUBLIC_REGION`) and routing. Internal VPC /
  localhost / service-binding URLs never appear in metadata.
- i18n config is owned per unit; no cross-unit runtime import.

### HTTP status semantics (CMS-grade)

| Status  | Meaning                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| 200     | current public document                                                                                      |
| 301/308 | moved / replaced — `Location` to a validated same-origin or root-relative target; never `200` + meta refresh |
| 404     | unknown document, or existence must not be disclosed                                                         |
| 410     | explicitly withdrawn and no replacement                                                                      |
| 5xx     | temporary Astro / Rails / Workers VPC failure                                                                |

Lifecycle → status is an explicit mapper (unit-tested), including the branch
where a security rule generalises a `gone` document to `404`. Outward error
bodies are generic — no Rails error body, internal hostname, S3 path, object key,
cookie, token, secret or stack trace. Internal logs classify the cause.

### Last-Modified / ETag / 304

`updated_at` → `Last-Modified` and dynamic-sitemap `<lastmod>`. A **deterministic
HTML ETag** is generated by Astro over `document revision + locale + region +
renderer version` — the Rails JSON ETag is never forwarded (different
representation). Once the representation contract is stable, `If-None-Match` /
`If-Modified-Since` are honoured and a conforming `304` returned.

### Sitemaps and robots.txt

Three streams: `/sitemap-index.xml`, `/sitemap-0.xml` (build-time URLs via
`@astrojs/sitemap`), `/sitemap-dynamic.xml` (an Astro endpoint that queries Rails
for the managed-document URL list). `robots.txt` is a first-class Astro endpoint
built from the production canonical host and points at `/sitemap-index.xml` — a
change from today's `Sitemap: <origin>/sitemap.xml`. Preview / development
hostnames are never advertised.

### Caching — two phases

- **Phase 1: no cache.** Every request goes to Rails. Routing, VPC, validation,
  200/3xx/404/410/5xx, canonical, hreflang, `Last-Modified`, `ETag`, security
  headers, sitemap, robots.txt, timeout, error handling, tests and observability
  must all work with nothing in front of them.
- **Phase 2: Cloudflare Workers Cache**, via Astro's cache abstraction /
  middleware, not Cloudflare logic scattered through components. `public GET/HEAD`
  → cache; explicit exceptions → bypass. Short TTL + natural expiry to start
  (`docs/caching-and-isr.md`: info/news ~300 s, help/docs ~1800 s). No purge
  webhook, no tag invalidation, no manual purge workflow. Purge is never a
  correctness requirement, and Rails deployments are never timed against cache
  expiry.

### Not in scope now

RSS (never), generated OG images (later), JSON-LD (later), MDX (until needed),
browser search. Metadata/layout structure is left easy to extend. Search is a
future **browser → versioned public API (`/api/v1/…`) → Rails** path; Astro may
prepare a search-island UI boundary but must not proxy search through SSR.

## Sub-decisions worth pinning (reverse one and something breaks)

1. **`output: 'static'`, not `'server'`.** Markdown pages prerender to the asset
   layer; Rails document routes and `/health`, `/`, `/revision` are
   `export const prerender = false`. `output: 'server'` would push every Markdown
   page through a Worker invocation for nothing.
2. **The Astro Cloudflare adapter reads `wrangler.jsonc`.** The TanStack
   `main: ./src/server.ts` config is gone; this file is the unit's only Wrangler
   input. The adapter writes the deployable Worker into `dist/astro`.
3. **`Astro.locals.runtime.env` was removed in Astro ≥ 6.** Bindings are read via
   `import { env } from 'cloudflare:workers'` — the same module the TanStack
   `src/lib/cloudflare-env.ts` used — and only from `prerender = false` modules
   (importing it in a build-time collection loader fails).
4. **`remoteBindings: false` unless `CLOUDFLARE_ENV=vpc`; `prerenderEnvironment:
'node'`.** A Workers VPC Service has no local simulator, so any build that
   resolves a config declaring `vpc_services` opens a remote proxy session that
   only an interactive `wrangler login` can authenticate. Same hazard, same fix
   as `adr/013` sub-decision 3.
5. **CSP is the production policy minus the nonce.** `build.inlineStylesheets:
'never'` + the service-worker registration as an external file →
   `script-src 'self'` / `style-src 'self'` with no nonce and no per-build hash.
   `frame-ancestors 'none'` and the other five headers stay. Static routes get
   them from `public/_headers`; on-demand routes from `src/middleware.ts`. Both
   must come from one `securityHeaders()` builder — **TODO**, not yet wired.
   `adr/011`'s "the CSP forbids inline script and inline style outright" is
   preserved: no island strategy may reintroduce an inline bootstrap.
6. **Environment separation preserved.** `local` and `test` and a plain
   `astro build` never touch the VPC binding; `test` cannot reach production
   Rails (`test/rails-connection-invariants.test.ts`). `@astrojs/cloudflare`'s
   `session: false` and `imageService: 'passthrough'` drop the adapter's default
   `SESSION` KV and image runtime.

## Sanctioned contract changes (the acceptance gate's exceptions)

1. **Rate limiting** — the per-request Worker limiter and its custom 429 HTML
   move to **Cloudflare Rate Limiting Rules** (platform config). App-level
   limiting stays only on on-demand routes.
2. **URL structure** — `/` is a `302` (language negotiation); content lives at
   `/{ja,en}/…`. Region is **not** a path (`PUBLIC_REGION` only — no `/jp/`).
   `GET /` / `GET /about` no longer return `200` on the unprefixed URL.
3. **`robots.txt` body** — target is `/sitemap-index.xml` (today still
   `/sitemap.xml`; remaining work).
4. **Sitemap** — three streams (`sitemap-index`, `sitemap-0`, `sitemap-dynamic`)
   replace the one hand-written `/sitemap.xml` (remaining work).

## Publishing pages (implemented 2026-09-10)

This is the document CMS slice that actually shipped. It does **not** change the Rails API.

- **Rails** remains the durable publishing authority. Edge consumes the existing contract:
  `GET /api/v0/entries?locale=`, `GET /api/v0/entries/:public_id?locale=`.
- **`public_id`** is the resource identity. Public URLs are `/{lang}/entries/{public_id}/`. There is no slug lookup, no search API, and no collection scan to discover an Entry.
- **Cloudflare Workers + Astro SSR.** Each publishing route is `export const prerender = false`. Hybrid `output: 'static'` is preserved for about/offline/404; publishing pages are on-demand.
- **Every page request** fetches Rails through the existing Workers VPC Rails client (`getEdgeBindings()` → `getRailsClient()` → `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`). No application cache, Workers Cache, ISR, or build-time content fetch.
- **No browser-side Rails fetch.** The first HTML contains title, heading, summary, and (when `body.text` is a string) body text. `body` is validated as an object; `body.text` is not a frozen public contract.
- **Language home** (`/{lang}/`) is prerendered SSG. It does not SSR Rails. A React island (`client:load`) fetches same-origin `GET /api/v0/entries?locale=` which the Worker answers through the existing VPC Rails client. The browser never calls a Rails origin. **About** (`/{lang}/about/`) stays static with no island. Global `/` still negotiates `Accept-Language` and 302s to `/ja/` or `/en/`.
- **Index** `/{lang}/entries/` lists one Rails page (cursor query is honoured; the Worker does not crawl every cursor).
- **Detail** `/{lang}/entries/{public_id}/` is addressable without visiting the index.
- Cell check: `namespace` + `surface` must match the unit (e.g. `info`/`app`) or the response is `invalid-contract` (502).
- Error mapping follows the existing Rails-client result kinds: 404 → 404; VPC missing/unreachable → 503; timeout → 504; Rails 5xx / invalid JSON / invalid contract / 401/403 / unexpected redirect → 502; 429 → 503; Astro throw → 500. Upstream bodies, hostnames, and `Set-Cookie` are not forwarded.

## Rails contract — recorded requirements, NOT settled here

Rails endpoint paths and final JSON schema are **not** decided in this work.
Astro requires only this semantics from a document representation, and every
field is Zod-validated at runtime before render:

`document identity`, `slug`, `locale / region`, `content representation`,
`updated_at`, `stable revision`, `lifecycle state`, `redirect target`.

TODO (Rails, future tasks):

- A public read endpoint returning the representation above for a
  `(slug, locale, region)`.
- A listing endpoint for `/sitemap-dynamic.xml` (`loc`, `lastmod`, locale
  alternate, region alternate). Until it exists, `/sitemap-dynamic.xml` is a
  stub returning a valid empty `<urlset>` and the index still references it.
- A versioned browser search API under `/api/v1/…` (`info` global, `docs`/`help`/
  `news` local; multiple TLD/surface entrypoints). Endpoint count, hostname,
  path, controller structure, engine, ranking, pagination, CORS and rate limit
  are all undecided.

## Observability

No new vendor. The closed structured-logging posture and `no-console` are kept.
The Astro document fetch logs **bounded fields only** — `surface`, `route class`,
`result class` (`ok` / `redirect` / `not-found` / `gone` / `upstream-error` /
`timeout` / `invalid-contract`), `upstream status class`, `upstream latency ms`,
`total server latency ms` — through a per-unit `document-fetch-log.ts` modelled
on `*/core/src/lib/rails-dispatch-log.ts` (closed unions, no free-text field). No
document body, arbitrary URL, search query, cookie, token, user id or raw Rails
error reaches a log line. `/health` stays a separate route and a separate client
module from document fetch even though both use the VPC binding.

## Repository-level updates

- `tools/workers-manifest.json` class `railsBackedAstro` and
  `checkAstroWorker()` in `tools/check-workers.mjs` — **done** (input config
  has no `assets.directory`; HTML handling is `auto-trailing-slash` /
  `404-page`).
- Generated Cloudflare types and invariant tests — updated for Astro health
  routes and title/layout paths. Further document-route invariants wait on
  Phase 3.

## Migration state (2026-09-02)

- **Phase 0 (done)** — twelve units Astro-only. Cores TanStack. Apex Hono.
  Language prefixes `/ja/` `/en/`. Region is `PUBLIC_REGION`, not a path.
- **Phase 3 (not done)** — document CMS: Content Collections, DocumentShell,
  Rails document SSR (fixtures until Rails exists), HTTP lifecycle including
  410, HTML ETag / Last-Modified / 304, three sitemaps, robots → sitemap-index,
  document-fetch log, on-demand CSP builder. **Plan:
  `plans/astro-content-surfaces-remaining.md`.** Start at `app/docs` only.
- **Phase 4 (not done)** — Workers Cache after Phase 3 is proven.
- **Ops (not done)** — production deploy; live VPC against Rails.

Cloudflare Dashboard resources were not touched. No deploy was run.

## Outcome

**Accepted for the framework decision and the twelve-unit Astro cutover.** The
document-SSR layer is designed here and scheduled in
`plans/astro-content-surfaces-remaining.md`; it is pending the Rails public
read contract and must not invent that contract. Proceed to production only
with an explicit deploy authorisation and a live Rails path, per `adr/013`'s
"do not deploy on this evidence alone."
