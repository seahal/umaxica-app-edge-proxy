# Grill me with docs: Astro public content surfaces

## Status

Superseded as the active working note. Framework cutover is done (`adr/015`).
**Remaining document-CMS work:** [`astro-content-surfaces-remaining.md`](./astro-content-surfaces-remaining.md).

Original implementation prompt / working plan below. **Astro / Edge side only. Do not modify the Rails repository.**

This plan covers migrating the public content surfaces in `seahal/umaxica-apps-edge` from TanStack Start to Astro:

- `app/{docs,help,info,news}`
- `com/{docs,help,info,news}`
- `org/{docs,help,info,news}`

Keep `*/core` on TanStack Start and keep apex Workers on Hono.

`adr/004-public-information-surfaces-astro.md` is a rejected historical record and explicitly says that reopening the decision requires a new ADR. Do not flip ADR 004 back to Accepted. Add a new ADR at implementation time that supersedes the public-surface portion of ADR 013 while leaving Core on TanStack Start.

## Repo-differential corrections already established

The first grill pass found several prompt assumptions that are not true in the current repository. Treat these as corrected inputs:

- `/robots.txt` already returns 200 on every frame. This migration changes its sitemap target/body; it does not introduce robots.txt from nothing.
- There is no settled locale-in-URL / region-in-URL / hreflang / x-default contract today. Do not claim to preserve one. The new ADR must make the locale/region/hreflang decision explicitly.
- The current sitemap is hand-written and minimal; `@astrojs/sitemap` is not already installed/configured in these units.
- The current worker manifest/checker models the public units as Rails-backed Vite/TanStack units. Astro needs its own worker class/check path because the Cloudflare adapter produces a different binding/output shape.
- Preserve the underlying hazards recorded by ADR 013 even when the TanStack-specific implementation changes: prerendered assets can bypass Worker middleware, and SSR failures must not accidentally become HTTP 200 shells.

## Source of truth and reference implementation

Treat this repository as the source of truth. Inspect current code before changing anything.

Use `seahal/hub` only as an implementation reference for Astro patterns, especially:

- Astro Content Collections
- `defineCollection()` + `glob()` loaders
- Zod schema validation
- `getCollection()` / `getEntry()` / `render()` for **Git-owned build-time Markdown only**
- Markdown authoring
- i18n patterns
- canonical and hreflang patterns
- `@astrojs/sitemap`
- strict Vitest/Hurl/Playwright layering

Do **not** create cross-repository imports or runtime dependencies on `seahal/hub`.

## Architectural decision

The public content workload is HTML-first and overwhelmingly read-only. Use Astro because its islands model fits the workload better than a React application runtime.

Responsibility split:

```text
Rails
  = durable content authority, policy, evolving /api/v0 public-read contract

Astro
  = routing, presentation, HTML generation, SEO, locale/region URLs

Cloudflare Workers VPC
  = private server-side transport from Astro to Rails

Cloudflare Workers Cache
  = later optimization, not part of the first correctness slice

Islands
  = interaction only
```

Do not turn Astro into an RP/BFF. Public Astro surfaces must not handle refresh tokens, authenticated mutation, user-scoped secrets, or browser session forwarding.

## API versioning

Use the Rails **`/api/v0`** contract for this work.

Do not design or depend on `/api/v1`.

`v0` intentionally means the first-party/private contract is still allowed to evolve. Astro and Rails may coordinate v0 shape changes during this migration. A future `v1` would be a deliberate freeze decision outside this task.

## Rendering: SSR for Rails-owned documents

Do not lazy-load SEO-visible document bodies in the browser.

For Rails-owned documents, use Astro on-demand rendering so the request flow is:

```text
Browser
  -> Astro SSR Worker
  -> Workers VPC binding
  -> Rails /api/v0 public read API
  -> runtime validation
  -> Astro components
  -> complete HTML
  -> Browser DOM
```

The initial HTML must contain the document title, headings, main content, canonical URL, hreflang metadata when defined, and indexable metadata.

Do not make Astro understand S3 buckets, object keys, or storage topology. Rails/storage may use S3 internally, but Astro consumes only a document representation contract.

Reuse/adapt the hardening already present in the current Rails client path: VPC binding transport, timeout, credential stripping, closed logging, and fail-closed behavior. Do not add a generic Rails proxy endpoint.

The Rails v0 response may evolve in the paired Rails task. On the Astro side, validate the approved runtime shape with Zod or an equivalent explicit schema before rendering.

## Rails-owned request-time data is not a Content Collection

Do not put request-time Rails reads behind `glob()` / `getCollection()` and pretend they are live.

Use Content Collections for Git-owned build-time Markdown only.

For Rails-owned documents, use a request-time server-side client + runtime validation. Do not adopt experimental Live Content Collections unless current official Astro documentation and an explicit ADR justify that choice.

If Rails returns structured body JSON, map it through explicit Astro components. If Rails returns Markdown/HTML, first establish the renderer/sanitizer/trust contract; do not use `set:html` on untrusted arbitrary upstream HTML.

## Markdown / Content Collections

Some documents should remain Git-owned and use Astro Markdown.

Adopt the `seahal/hub` style:

```text
src/content.config.ts
src/content/<collection>/<locale>/**/*.md
src/schemas/*.ts
```

Use Content Collections with schema validation. Authoring errors should fail the build.

Do not duplicate presentation between Markdown documents and Rails documents. Both should normalize into one presentation model consumed by a common document shell/layout.

Do not add MDX until a concrete requirement needs component execution inside content.

## Output / prerender decision must account for security headers

Do not choose `output: static` vs `output: server` mechanically.

The new ADR must explicitly resolve:

- Git-owned Markdown build-time rendering vs Rails-owned on-demand rendering;
- whether prerendered Markdown is served before Worker middleware;
- how static responses receive the same CSP/security headers as on-demand responses;
- how 404/410/error pages preserve exact status codes and security headers.

If static `_headers` and Astro middleware are both required, derive them from one policy source or generate one from the other; do not maintain two drifting security policies by hand.

## i18n / region

This is a **new design decision**, not merely preservation of an existing Astro URL policy.

Current units have a default locale but no settled locale-prefix/hreflang/x-default contract. Region is currently encoded in deployment/host naming rather than a complete Astro routing model.

The new ADR must decide, based on current product requirements and repo topology:

- locale URL shape;
- default locale prefix behavior;
- how region relates to host/deployment;
- whether future additional regions require separate builds/hosts;
- x-default policy, or explicit omission;
- how Rails-owned documents communicate which locale/region counterparts actually exist.

Astro owns final `<html lang>`, canonical URLs and alternate/hreflang URLs.

Only emit alternate links for real counterparts. Never assume every locale exists for every document.

## Canonical

Every indexable page needs exactly one canonical URL.

Canonical means the preferred Web URL for the representation; it is not a DOI-like durable identifier.

Generate canonical URLs in Astro from the public routing/TLD/locale/region model. Do not make Rails own absolute presentation URLs.

## HTTP semantics

Treat these surfaces as a CMS and make status codes exact:

```text
200  current public document
3xx  moved document / replacement URL
404  unknown or intentionally undisclosed
410  explicitly withdrawn/deleted with no replacement
5xx  temporary Edge/Rails/VPC failure
```

Do not use `200 + meta refresh` for moves. Do not collapse every retired document to 404 when 410 is semantically correct.

Validate any redirect target before using it. Astro constructs the final public URL from approved same-site routing data; do not trust arbitrary upstream absolute URLs.

Public error bodies must be generic. Internal failure reasons can be distinguished only in closed structured logs. Do not leak Rails error bodies, storage paths, secrets, cookies, or internal hostnames.

## Last-Modified / ETag

Carry the approved Rails public-updated timestamp and stable immutable published-version marker through the Astro presentation model.

- public updated time -> `Last-Modified`
- immutable published version + locale/region + renderer/build version -> HTML representation `ETag`

Do not copy a Rails JSON ETag directly onto rendered HTML; JSON and HTML are different representations.

The Astro implementation must define where its renderer/build version comes from and whether the HTML representation qualifies for a strong ETag. Use a weak validator if byte identity is not guaranteed.

Implement deterministic conditional request handling (`If-None-Match` / `If-Modified-Since` -> `304`) once the representation contract is stable.

Use the same public updated time for dynamic sitemap `<lastmod>`.

## Cache rollout

### Phase 1: no Workers Cache

First make every Rails-owned document request actually reach Rails:

```text
request -> Astro SSR -> Workers VPC -> Rails /api/v0 -> validate -> HTML
```

Establish correctness first:

- routing
- VPC transport
- validation
- HTTP lifecycle semantics
- canonical / hreflang
- Last-Modified / ETag
- security headers
- sitemap
- timeout/error behavior
- tests and observability

### Phase 2: short-TTL Workers Cache

After Phase 1 is proven, integrate Astro's caching abstraction with `@astrojs/cloudflare` / Workers Cache using the current official API.

Prefer **cache by default, explicit bypass for exceptions** rather than a large route-by-route cache table.

Express cache intent through Astro middleware, not Cloudflare-specific cache code scattered across page components.

Initial cache policy should use short TTL + natural expiry. Do not implement purge webhooks/tag invalidation initially.

Do not make deploy correctness depend on timing a Rails deployment immediately before cache expiry. Cache expiry is not globally synchronized by URL/colo/request time.

## Sitemap

Target three logical sitemap resources:

```text
/sitemap-index.xml
/sitemap-0.xml          # build-known Astro routes
/sitemap-dynamic.xml    # Rails-owned SSR documents
```

Use `@astrojs/sitemap` where it actually fits the build-known route set.

Generate `/sitemap-dynamic.xml` from an Astro server endpoint that fetches a lightweight published-document listing from Rails over Workers VPC. The paired Rails task decides/refines the `/api/v0` listing contract.

**Do not assume a runtime sitemap can be injected into the generated Astro sitemap index by a specific integration option until verified against current official Astro docs.** If no supported mechanism exists, generate the sitemap index explicitly as an Astro endpoint or otherwise choose the smallest supported architecture and record it in the ADR.

Include `lastmod` from the approved public updated time when available and preserve locale/region alternate metadata where valid.

## robots.txt

`/robots.txt` already exists and returns 200. Update it rather than introducing a new route contract.

Change its sitemap reference from the current single sitemap to the final sitemap index:

```text
User-agent: *
Allow: /
Sitemap: https://<canonical-host>/sitemap-index.xml
```

Update the existing Hurl/API contract accordingly.

Ensure preview/development hosts do not accidentally advertise themselves as the canonical production sitemap host.

## Search: intentionally deferred Rails contract

Search is a separate path from document SSR.

Future direction:

```text
Browser
  -> evolving first-party API under /api/v0/...
  -> Rails
  -> JSON search results
```

Do not make Astro a search API proxy.

Known requirements only:

- `info` uses a global search entry
- `docs` / `help` / `news` use local search entries
- multiple TLD/surface search entry points will exist
- the API remains under v0 until a future deliberate freeze decision

Do not freeze the number of endpoints, hostname layout, controller/service shape, search engine, ranking, CORS, or rate-limit details in this task. Leave an explicit TODO for the later Rails/search design task.

Astro may expose only the UI/island boundary needed for future search.

## Security headers

Preserve the current security-header contract during migration. Astro must not weaken CSP or other headers merely to make the framework migration easier.

Review at least:

- CSP
- `frame-ancestors`
- Referrer-Policy
- X-Content-Type-Options
- Permissions-Policy
- existing HSTS ownership
- current prohibition/handling of inline script/style
- island hydration implications

The server-side Workers VPC fetch is not a browser `connect-src` concern. Browser -> Rails search API policy is deferred to the search task.

Never copy arbitrary upstream Rails response headers onto the public Astro response. Build the public response headers from Astro-owned policy.

## Observability

Do not add a new observability vendor.

Preserve the repository's `no-console` rule and closed structured logging style.

For Astro -> Rails document requests, record only bounded/closed fields such as:

- surface/route class
- result class (`ok`, `redirect`, `not-found`, `gone`, `upstream-error`, `timeout`, `invalid-contract`)
- upstream status class
- upstream latency milliseconds
- total server latency milliseconds

Do not log document bodies, search queries, arbitrary URLs, cookies, tokens, user IDs, or raw upstream error bodies.

Model the logger after existing closed structured log types rather than introducing free-text application logging.

## Workers VPC and local development

Preserve the existing environment separation and binding name `UMAXICA_APPS_EDGE_CF_WORKERS_VPC` unless a current Cloudflare/Astro constraint forces a documented change.

The current bootstrap deliberately uses the same existing development VPC service ID in some tiers; do not invent service separation that does not exist. The safety invariant for `test`/plain local work is **absence of the VPC binding**, not a different service ID.

Everyday local development should remain credential-free. Explicit VPC development may use remote bindings. Test/plain build must not open a remote binding session accidentally.

Update `tools/check-workers.mjs`, manifests, generated types, and invariant tests together with the framework migration. Add an explicit Astro worker classification/check path instead of forcing Astro output through Vite/TanStack invariants that do not apply.

## Health

Do not treat the existing Rails-touching `/health` as a blocker to Astro. Astro Workers can use the same VPC binding.

Preserve the health contract, but keep health probing separate from public document fetching. Neither should become a generic proxy.

## RSS / OG / JSON-LD

Out of scope for this implementation slice:

- RSS: do not add
- generated OG images: defer
- JSON-LD: planned later, do not implement now

Keep the metadata/layout structure easy to extend later.

## Testing

Preserve the repository's layer contract.

### Vitest — internal logic

Cover at minimum:

- upstream schema validation
- lifecycle -> HTTP mapping
- canonical builder
- locale/region alternates
- ETag determinism
- Last-Modified formatting
- sitemap model/XML generation helpers
- security header builder
- structured-log redaction/closed fields
- negative test that upstream Rails response headers/cookies are not forwarded
- cache middleware only when Phase 2 lands

### Hurl — HTTP contract

Run Hurl against the built Cloudflare/Astro Worker path that represents production behavior, not merely an Astro/Vite dev server if that would bypass `_headers` or adapter behavior.

Cover at minimum:

- 200 document
- 3xx + `Location`
- 404
- 410
- upstream failure -> generic 5xx
- correct `Content-Type`
- canonical in rendered HTML
- Last-Modified / ETag
- 304 once conditional handling lands
- existing `/robots.txt` -> 200 text/plain with sitemap-index reference
- `/sitemap-index.xml`
- `/sitemap-0.xml`
- `/sitemap-dynamic.xml`
- security headers

### Playwright — browser behavior only

Use only for real-engine behavior: DOM/rendering, accessibility tree, islands, keyboard/focus, responsive layout. Do not duplicate status/header tests here.

## Migration strategy

Do not convert all 12 units blindly in one giant unverified rewrite.

Recommended sequence:

1. Write new ADR with the output/prerender/i18n/region/security-header decisions.
2. Choose one representative public unit (prefer one `docs` unit) and migrate it atomically to Astro.
3. Add the Astro worker manifest/check class needed by that pilot.
4. Prove local build/test/Hurl/Playwright and explicit Workers VPC path.
5. Prove Rails-owned SSR document rendering from `/api/v0` with Workers Cache disabled.
6. Add Markdown Content Collection path and shared normalized DocumentShell model.
7. Add canonical/i18n/status/validators/sitemap/robots/security semantics.
8. Replicate the proven implementation to the other 11 public units while preserving unit independence.
9. Update repository-wide worker/dependency/invariant checks.
10. Only after correctness is stable, add Workers Cache Phase 2.

Do not deploy or change Cloudflare Dashboard resources without explicit authorization.

## Acceptance criteria

The work is complete only when:

- `*/core` remains TanStack Start and unchanged in framework responsibility.
- all 12 public content units build/run as Astro on Cloudflare Workers.
- Rails-owned main content is SSR-rendered into initial HTML, not lazy-loaded after page load.
- Rails interaction uses the evolving `/api/v0` contract; no `/api/v1` dependency is introduced.
- Git-owned Markdown documents use Content Collections with schema validation.
- request-time Rails data is not misrepresented as a build-time Content Collection.
- VPC connectivity remains private and no generic proxy exists.
- canonical and the newly-decided locale/region/hreflang contract are implemented consistently.
- 200/3xx/404/410/5xx semantics are tested.
- Last-Modified/ETag are deterministic and tested.
- sitemap index contains build-known and dynamic sitemap sources using a verified supported mechanism.
- existing robots.txt points to the sitemap index.
- current CSP/security posture is preserved or strengthened for both static and on-demand responses.
- search remains a documented future browser->Rails `/api/v0/...` API, not an Astro proxy.
- RSS/OG image generation/JSON-LD remain deferred.
- Phase 1 works with Workers Cache disabled.
- Phase 2 cache work, if included, uses short TTL/natural expiry and does not require purge to be correct.
- repository `pnpm run check`, relevant builds, Hurl and browser tests are green.
