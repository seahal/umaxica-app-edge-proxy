# Public Information Surfaces

Project Umaxica separates application surfaces from public knowledge surfaces.
The split is **authority-level, not framework-level**: Rails remains the source
of truth for policy, mutation, and content JSON authority, and the Edge surfaces
differ in what they are allowed to do rather than in what they are built with.

> **Framework note.** `adr/004-public-information-surfaces-astro.md` (2026-08-12)
> rejected an Astro move for the content frames and stays `Rejected` as history.
> `adr/015-public-content-surfaces-astro.md` (2026-09-02) is the new record that
> `adr/013` invited: the **twelve** public content surfaces
> (`{app,com,org}/{docs,help,info,news}`) are Astro, partially superseding
> `adr/013` for those units. The three `*/core` units stay on TanStack Start and
> the five `*/apex` Workers stay on Hono (`adr/011`). Language is a URL prefix
> (`/ja/`, `/en/`) because Astro i18n needs it; region is **not** a path
> (`PUBLIC_REGION` at build time — no `/jp/`). See `adr/015` § i18n / region.
> The Rails-managed-document SSR layer is designed in `adr/015` and scheduled
> in `plans/astro-content-surfaces-remaining.md`; it is pending the Rails
> public read contract.

## Surface Matrix

| Workspace family | Core app   | Public docs | Public news | Public info | Public help |
| ---------------- | ---------- | ----------- | ----------- | ----------- | ----------- |
| `com`            | `com/core` | `com/docs`  | `com/news`  | `com/info`  | `com/help`  |
| `org`            | `org/core` | `org/docs`  | `org/news`  | `org/info`  | `org/help`  |
| `app`            | `app/core` | `app/docs`  | `app/news`  | `app/info`  | `app/help`  |

## Framework Ownership

The twelve public content surfaces run **Astro**. The three cores run
**TanStack Start**. The five apex workers run **Hono**. That split is `adr/015`;
`adr/004` stays `Rejected` as history.

What differs between the two archetypes is capability, and it is deliberate:

`*/core` owns RP/BFF behavior, authenticated UI, logged-in state, React Aria
surfaces, and account, organization, and avatar operations. It is the only
archetype that holds session material.

`*/docs`, `*/news`, `*/info`, and `*/help` are public content surfaces. They are
limited to public content and read-only content APIs.

Rails Core/Base owns durable authority: policy, mutation, content JSON, and the
API contracts consumed by edge surfaces.

## Content API Boundary

Public information surfaces consume only public, read-only Rails content APIs
through the Cloudflare Workers private connectivity boundary. The contract is
intentionally narrow:

- Server-side GET requests only.
- Public/read-only content JSON only.
- No Acme refresh tokens.
- No user-scoped secrets.
- No browser session-cookie forwarding.
- No generic Rails proxy endpoint on a public surface.

Authenticated RP/BFF behavior remains in `*/core`. Authorization and mutation
remain in Rails.

Two mechanisms enforce this rather than convention alone: `*/core/src/worker.ts`
strips credentials on the Rails hop (ADR 007), and
`tools/workers-manifest.json` classifies each Worker so `pnpm run check:workers`
fails a surface that declares a binding its class is not allowed to hold.

## Implementation State

The three cores are classified `railsBackedVite` and the twelve public surfaces
`railsBackedAstro` in `tools/workers-manifest.json`. All fifteen carry the VPC
binding.
On the twelve public surfaces the VPC binding is used for `/health` (ADR 016)
and for **publishing pages**: `/{lang}/entries/` and `/{lang}/entries/{public_id}/`
are on-demand Astro SSR routes that call the existing `getRailsClient()` on every
request. Rails remains the publishing authority for persistence, management UI,
create/update, revisions, publication, archive, and authorization. Astro is
anonymous and read-only. Collection pagination is page-based: `/{lang}/entries/?page=N`
causes Edge to request `GET /api/v0/entries?locale={lang}&page=N`. Edge does not
calculate SQL OFFSET; Pagy is a Rails implementation detail. Page 1 is
`/{lang}/entries/`. Identity is `public_id` on both the public URL and the Rails
management member URL. Language homes `/{lang}/` are prerendered SSG and link to
`/{lang}/entries/`. `/{lang}/about/` stays static with no Rails hop. There is no
publishing SSG of Entry pages, no browser-side Rails fetch, and no
application-level publishing cache in this phase (`docs/caching-and-isr.md`
Phase 2 remains future work).

Public collection and entry pages always expose a Manage / Edit link to the
browser-facing Rails Base.Org staff origin (`RAILS_STAFF_BASE_ORIGIN`), for example
`{origin}/publishing/{surface}/{audience}/entries` and
`{origin}/publishing/{surface}/{audience}/entries/{public_id}/edit`. The link is
not gated on Edge authentication. Rails performs sign-in and authorization after
navigation. That origin is not the Worker-to-Rails VPC transport.

`org/core` `/publishing` is the authenticated operator launcher for the same
twelve Rails management indexes. It does not implement Publishing mutations.
