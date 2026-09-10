# Remaining work: Astro public content surfaces (document layer)

## Status

Working plan. **Publishing SSR (Phase 3 Rails read) is in tree** as of 2026-09-10: all twelve units serve `/{lang}/entries/` and `/{lang}/entries/{public_id}/` as on-demand Astro SSR over the existing Workers VPC Rails client, keyed by `public_id`. Language homes redirect to the entries index. No application cache. Remaining Phase 3 items below are Content Collections, ETag/304, three-stream sitemaps, and structured-body rendering. Decisions live in `adr/015-public-content-surfaces-astro.md`.

Astro / Edge only. Do not modify the Rails repository. Do not invent a frozen Rails path or JSON schema. Do not deploy without an explicit go-ahead. Do not start Phase 2 Workers Cache until Phase 1 document correctness is proven.

## Already done (do not redo)

Recorded so the next pass does not re-migrate the framework.

- Twelve units `{app,com,org}/{docs,help,info,news}` are Astro-only (`src/`, `astro.config.mjs`, `output: 'static'`). TanStack Start is gone from those units.
- `{app,com,org}/core` stay TanStack Start. Apex stays Hono.
- ADR 004 stays Rejected. ADR 015 is Accepted for the framework split.
- Workers VPC binding name `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`. `/health` is a separate on-demand route from any future document fetch.
- Manifest class `railsBackedAstro` and `checkAstroWorker()` in `tools/check-workers.mjs`.
- Language in the URL: `/ja/…`, `/en/…` (`prefixDefaultLocale: true`). `/` negotiates and 302s. `/{lang}/` is SSG plus a React island that fetches same-origin `/api/v0/entries`; `/{lang}/about/` is static. `/{lang}/` links to `/{lang}/entries/`. `<html lang>`, canonical, hreflang, `x-default` → `ja` on the current static pages.
- Publishing SSR: `/{lang}/entries/` and `/{lang}/entries/{public_id}/` fetch `GET /api/v0/entries` through the existing Rails client on every request (`prerender = false`). Rails API unchanged. No SSG of Entry identifiers. No browser-side Rails fetch. No application publishing cache.
- Region **not** in the URL. No `/jp/`. `PUBLIC_REGION` at build time selects the canonical origin. That is an explicit change from a path-shaped `region × language` URL; see ADR 015 § i18n / region.
- `robots.txt` exists (200). Body still points at `/sitemap.xml`, not the three-stream index.
- One hand-written `/sitemap.xml` listing `/` and `/about` only.
- Static CSP and related headers in `public/_headers`. Directory HTML handling is `auto-trailing-slash` / `404-page`.
- RSS, generated OG images, JSON-LD: correctly absent.
- Local preview strips VPC (`tools/preview-astro-worker.mjs`). Production deploy scripts are not the cutover yet.

## Remaining — Phase 3 (document CMS, cache-less)

One unit first: **`app/docs`**. Prove it. Then copy to the other eleven. Do not blind-rewrite all twelve again.

### 1. Content Collections (Git Markdown)

- Add `src/content.config.ts`, `src/schemas/*.ts`, `src/content/<collection>/<locale>/**/*.md`.
- `defineCollection()` + `glob()` + Zod frontmatter. Invalid authoring is a **build failure**.
- MDX is out of scope until a Markdown body actually needs component execution.

### 2. Shared DocumentShell

- One `DocumentShell` / `DocumentLayout`.
- Markdown `render()` and a Rails JSON mapper both feed it. Do not double-implement the document UI.

### 3. Rails document SSR (fixtures only until Rails exists)

Semantics Astro requires (Zod-validated at runtime; paths/schema **not** frozen here):

`document identity`, `slug`, `locale / region`, `content representation`, `updated_at`, `stable revision`, `lifecycle state`, `redirect target`.

- Same VPC client family as `/health`. New call site, not a generic proxy. No `Set-Cookie` or arbitrary Rails headers to the browser.
- Invalid upstream → 5xx, `result class = invalid-contract`. Never render invalid JSON.
- No browser-side fetch of indexable body text.
- Astro never learns S3 / object keys / storage topology.
- Record the Rails read + listing contracts as TODOs in ADR 015 (already sketched). Tests use fixtures.

HTTP mapper (unit-tested):

| Status  | Meaning                                               |
| ------- | ----------------------------------------------------- |
| 200     | current public document                               |
| 301/308 | moved/replaced — `Location`, never 200 + meta refresh |
| 404     | unknown, or existence must not be disclosed           |
| 410     | withdrawn, no replacement                             |
| 5xx     | temporary Astro / Rails / VPC failure                 |

Outward error bodies stay generic.

### 4. Last-Modified / HTML ETag / 304

- `updated_at` → `Last-Modified` and dynamic-sitemap `<lastmod>`.
- Deterministic **HTML** ETag from `revision + locale + region + renderer version`. Do not forward the Rails JSON ETag.
- Honour `If-None-Match` / `If-Modified-Since` once the representation is stable.

### 5. Sitemaps and robots.txt

```text
/sitemap-index.xml
/sitemap-0.xml          build-time URLs (@astrojs/sitemap)
/sitemap-dynamic.xml    Rails listing endpoint (stub empty urlset until Rails exists)
```

Point `robots.txt` `Sitemap:` at `/sitemap-index.xml` on the **production canonical host**. Do not advertise preview/dev hostnames.

### 6. Observability

No new vendor. `no-console` stays. Document fetch logs closed fields only (`surface`, `route class`, `result class`, `upstream status class`, latencies). Per-unit `document-fetch-log.ts` modelled on core's rails-dispatch log. No body, URL, query, cookie, token, user id, raw Rails error.

### 7. Security headers on on-demand document routes

Static pages already use `public/_headers`. On-demand document routes need the same policy (ADR 015 sub-decision 5 still TODO: one `securityHeaders()` builder). Do not weaken CSP.

### 8. Search — TODO / UI boundary only

Not proxied through Astro SSR.

- `info` = global search; `docs` / `help` / `news` = local.
- Future browser → Rails `/api/v1/…`. Hostname, path count, engine, ranking, pagination, CORS, rate limit: undecided.
- Optional: a dead island slot on the shell. No live search.

### 9. Tests (existing layering)

- **Vitest:** Zod validation, lifecycle → HTTP, canonical/hreflang builders, ETag, Last-Modified, sitemap helpers, log field unions, (later) cache middleware.
- **Hurl:** 200 document, 3xx + Location, 404, 410, generic 5xx, Content-Type, canonical, Last-Modified, ETag, 304, robots, sitemap-index / 0 / dynamic, security headers.
- **Playwright:** rendered document DOM, a11y, islands, focus. No status/header duplication.

### 10. Docs drift to fix in the same slice

Keep `docs/public-information-surfaces.md` aligned with ADR 015 (framework split and language-vs-region URLs). Do not leave it describing fifteen TanStack frames.

## Remaining — Phase 4 (after Phase 3 is proven)

Workers Cache: public GET/HEAD cached by default; explicit bypasses only. Short TTL + natural expiry. No purge webhook, no tag invalidation, no purge-as-correctness. Cloudflare-specific cache logic stays out of page components.

## Remaining — ops (explicit permission)

- Production `wrangler deploy` of the Astro artefact (`dist/astro/server/wrangler.json`, VPC **included**).
- Live VPC `remote: true` against Rails (local `/health` 503 `not-configured` is ADR 009's documented default).
- Cloudflare Dashboard: do not change resources unasked.

## Order

1. `app/docs` only: Collections + DocumentShell + fixture Markdown.
2. Same unit: Rails document client interface + Zod + HTTP mapper + ETag/Last-Modified against fixtures.
3. Same unit: three sitemaps + robots → sitemap-index.
4. Vitest + Hurl + Playwright on that unit.
5. Copy to the other eleven.
6. Repository invariants / `pnpm run check`.
7. Only then Phase 4 cache.

## Out of scope

Rails repository. `/api/v1` search implementation. RSS. OG image generation. JSON-LD. MDX. `/jp/` path segments. Re-introducing TanStack on the twelve. Dashboard edits. Deploy.
