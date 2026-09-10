# Astro publishing SSR over Workers VPC

Date: 2026-09-10

## What was verified

On-demand Astro SSR publishing pages were added to all twelve `{app,com,org}/{docs,help,info,news}` units.

- `/{lang}/` 302s to `/{lang}/entries/`.
- `/{lang}/entries/` and `/{lang}/entries/{public_id}/` are `export const prerender = false`.
- Content is fetched per request through the existing `getRailsClient()` / Workers VPC binding. Rails API is unchanged (`GET /api/v0/entries`, `GET /api/v0/entries/:public_id`). Identity is `public_id`.
- No `getStaticPaths()`, no browser-side Rails fetch, no application cache.

## Commands

```bash
pnpm --dir app/info run test          # 166 passed
pnpm --dir app/docs run test          # 221 passed
# remaining ten units: 166 passed each
RAYON_NUM_THREADS=1 pnpm --dir app/info run build
# prerender list: 404, 500, en/about, ja/about, manifest, offline, robots, sitemap
# language homes and entries routes are not prerendered
pnpm exec vitest run --dir test html-title-contract
```

## Known limitation

`body` is validated as an object. `body.text` is rendered only when it is a non-empty string; there is no frozen CMS body schema.
