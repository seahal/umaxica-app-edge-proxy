# app/docs CMS SSR over Workers VPC temporary bootstrap — 2026-09-03

## Scope and topology

This was a temporary, non-production verification deployment for `app/docs` only. It used the existing development VPC Service (`019f5fe0-287f-7040-9f2f-036cb5b21df7`) and was intended to use the existing development Tunnel and development Rails. It did not establish or verify a production Rails/Tunnel/VPC topology.

The generated deployment config contained `workers_dev: true`, no Worker routes or custom domains, the temporary environment value `cms_bootstrap`, and the Worker name `umaxica-apps-edge-app-docs-cms-bootstrap`. Because the deploy command inherited Wrangler's existing `development` environment selection on the initial create, Cloudflare created the clearly temporary script as `umaxica-apps-edge-app-docs-cms-bootstrap-development`.

## Build and local verification

Commands executed:

- `pnpm install` — lockfile was current; no dependency changes.
- `pnpm --dir app/docs run check` — passed after implementation: formatting, Oxlint, type-aware Oxlint, generated Cloudflare types, TypeScript, Knip, and Vitest.
- `pnpm --dir app/docs run test` — 18 test files and 114 tests passed.
- `pnpm --dir app/docs run test:api` — 4 Hurl files and 29 real HTTP requests passed, including the local CMS configuration-failure response.
- `pnpm --dir app/docs run build` — passed for the normal production-mode build.
- `pnpm --dir app/docs run check:size` — passed; measured 102.25 kB gzip against a 112 kB limit.
- `CLOUDFLARE_ENV=cms_bootstrap PUBLIC_REGION=jp pnpm --dir app/docs exec astro build` — passed and produced an Astro Cloudflare server bundle with the temporary Worker name and VPC Service binding.
- `pnpm run check` — attempted repository-wide; stopped in the format fan-out because the untouched `app/help/astro.config.mjs` was already not accepted by Oxfmt. The scoped `app/docs` gate above passed.

The tests exercised the complete status mapper, 204/empty success, malformed JSON, closed body schema, unknown top-level fields, locale/slug identity mismatch, fixed/validated paths, manual redirect handling inherited from the Rails transport, credential header stripping, 5 second timeout classification, known/unknown transport classification, declared and streaming 1 MiB limits, runtime binding invariants, and closed structured log shape.

## Cloudflare deployment

Target:

- Worker: `umaxica-apps-edge-app-docs-cms-bootstrap-development`
- workers.dev hostname: `https://umaxica-apps-edge-app-docs-cms-bootstrap-development.umaxica.workers.dev`
- current version: `a33a8248-b055-41a7-a91f-d65d116b474c`
- retained rollback version: `b0827a1f-0b8e-4778-bbc9-608e2514c31f`

The initial create used `wrangler deploy`, because Cloudflare rejected `wrangler versions upload` for a Worker that did not yet exist. The checked update then used `wrangler versions upload` and `wrangler versions deploy <version>@100`. Upload output listed the expected VPC Service binding and reported Worker startup time of 22 ms.

## Deployed observations

- `GET /revision` returned 200 with `Cache-Control: no-store` and the current version ID, proving the promoted Astro Worker version started and answered through workers.dev.
- `GET /health` returned 503. Its Edge half was `ok` and identified the current version; Rails liveness was `unreachable`.
- `GET /ja/cms-pilot-probe` returned generic HTML with 504 after the configured upstream deadline. It had `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; the response exposed no Rails body, binding name, private hostname, VPC error, exception text, URL, headers, or credentials.
- The deployed config and upload both contained the required VPC Service binding. Binding presence is verified; successful private transport is not.

## Not verified

The development Tunnel/private Rails destination was not running or reachable from this workspace during deployed verification. This environment had neither `podman` nor `cloudflared` installed, so the connector/Rails process could not be started here. Consequently none of the following is recorded as verified:

- successful deployed Worker → VPC Service → development Tunnel → private Rails `/health`;
- successful deployed CMS index `GET /api/v0/entries?locale=ja`;
- existence or selection of a real CMS slug;
- successful real CMS show;
- CMS text in initial SSR HTML or with JavaScript disabled;
- deployed Rails 404 → Astro 404;
- success-page canonical/hreflang/title/description inspection;
- production Rails connectivity (explicitly out of scope).

No fixture or invented slug was deployed. No Rails origin, Worker route, production custom domain, cache, Cache API, or stale fallback was introduced.
