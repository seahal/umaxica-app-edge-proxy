# Publishing read path (Astro) and operator launcher

Astro public surfaces are **read-only**. Rails owns Publishing RW: persistence,
management UI, create/update, revisions, publication, archive, and
authorization. Edge must not proxy the CMS, recreate forms, or mutate entries.

## Public URLs

- Collection: `/{ja|en}/entries/` and `/{ja|en}/entries/?page=N` (page 1 omits the query).
- Entry: `/{ja|en}/entries/{public_id}/`.

Do not use `/page/2/` path segments. Do not expose `limit` or `offset` as public
parameters.

## Rails collection request

```
GET /api/v0/entries?locale={lang}
GET /api/v0/entries?locale={lang}&page=N
```

Edge forwards the public page number. It does not calculate SQL OFFSET. Pagy is
internal to Rails. The application envelope is:

```json
{
  "data": [],
  "page": { "current": 2, "previous": 1, "next": 3, "last": 10 }
}
```

The former publishing cursor contract (`cursor`, `next_cursor`, `has_more`) is
not used on this path.

## Identity

`public_id` is both the public Astro member identity and the Rails management
member identity. Do not use database ids, slug, or `slug_id` in management URLs.

## Management links (intentional, always visible)

Astro does not authenticate. Every collection page links to

`{RAILS_STAFF_BASE_ORIGIN}/publishing/{surface}/{audience}/entries`

and every entry page links to

`{RAILS_STAFF_BASE_ORIGIN}/publishing/{surface}/{audience}/entries/{public_id}/edit`

Rails then signs the visitor in or denies access. `RAILS_STAFF_BASE_ORIGIN` is the
browser-facing Base.Org origin (`https://www.umaxica.org/`).
It is not the VPC binding or a `*.{app,com,org}.localhost` surface host.

Surfaces are `info|docs|news|help`. Audiences are `app|com|org`.

## Operator hub

`org/core` serves `/publishing` as a launcher for the same twelve Rails indexes.
It is not a CMS.
