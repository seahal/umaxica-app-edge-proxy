# Publishing page pagination and management launcher

Date: 2026-09-10

## What was verified

- All twelve `{app,com,org}/{docs,help,info,news}` Astro units consume Rails
  Pagy page metadata (`page.current|previous|next|last`) instead of
  `cursor` / `next_cursor` / `has_more`.
- Public collection URLs are `/{lang}/entries/` (page 1) and
  `/{lang}/entries/?page=N`. Edge requests
  `GET /api/v0/entries?locale={lang}` or `...&page=N`.
- Malformed `?page=` values are HTTP 400, not rewritten to page 1.
- Collection pages always link to
  `{RAILS_STAFF_BASE_ORIGIN}/publishing/{surface}/{audience}/entries`.
- Entry pages always link to
  `{RAILS_STAFF_BASE_ORIGIN}/publishing/{surface}/{audience}/entries/{public_id}/edit`.
- `org/core` `/publishing` launches all 12 Rails indexes. Vitest: 363 passed.

## Commands

```bash
pnpm --dir org/news run test          # 169 passed
pnpm --dir org/core run test          # 363 passed
# remaining eleven Astro units: 169 passed each (app/docs 224)
pnpm exec vitest run --dir test publishing-page-contract  # 12 passed
pnpm --dir org/news run lint:types
pnpm --dir org/core run lint:types
```

Follow-up (same date): review findings addressed.

- Vitest 5: `coverage.thresholds.perFile`, dropped `minWorkers`.
- Astro knip: no empty `*.tsx` entry globs; unused React integration removed.
- Spelling: encoded `public_id` via `encodeURIComponent`.
- `org/core` `/publishing` reads `RAILS_STAFF_BASE_ORIGIN` in a `createServerFn` handler (`*.server.ts`), not in the client component. Build succeeds.
- CMS slug lookup in `app/docs` walks at most 3 index pages.
