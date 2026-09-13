# Plans

Working notes for scoped features and refactors, before and during
implementation. Twenty-five of them at the time of writing, none numbered.

## How this actually works

The original workflow was: number a plan `NNN-title.md`, open a matching GitHub
issue, then move the file to `/adr/` and append an `## Outcome` when it merged.
That is not what happens now, and the drift had gone far enough to be misleading:

- **Plans are not numbered.** All twenty-five carry generated slugs
  (`rails-dev-eager-sedgewick.md`, `you-are-working-in-tranquil-adleman.md`).
  Zero files here match `NNN-`.
- **Plans are not moved to `/adr/`.** ADRs are written as their own records, and
  the plan file stays here as the working note it was. So a plan and an ADR are
  no longer two states of one file, and their numbers do not correspond — this
  README used to imply they did, and listed a "Plan 004" that pointed at a file
  which does not exist.
- **`/adr/` is the authoritative index of decisions**, not the table below. See
  `adr/README.md`.

So: read `/adr/` for what was decided. Read this directory for the reasoning and
measurements that went into a piece of work, including work that was never
finished. Nothing here is a specification.

## Architecture decisions, for orientation

The list `/adr/` owns; reproduced here only because plan notes cross-reference it.

| ADR                                                                   | Status                                | Title                                                  |
| --------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| [001](../adr/001-rails-health-check.md)                               | Superseded by 005                     | Rails backend health check integration                 |
| [002](../adr/002-dev-apex-vercel.md)                                  | Completed; `dev/apex` revived 2026-08 | Create `dev/apex` — Hono on Vercel                     |
| [003](../adr/003-apex-direct-composition.md)                          | Completed                             | Migrate apex workspaces to direct Hono composition     |
| [004](../adr/004-public-information-surfaces-astro.md)                | **Rejected 2026-08-12**               | Public information surfaces use Astro                  |
| [005](../adr/005-rails-edge-workers-vpc-connection.md)                | Completed; amended by 006, 009        | Rails ↔ Edge over a Cloudflare Workers VPC binding     |
| [006](../adr/006-development-workers-vpc-transport.md)                | Implemented; amended by 008           | A development transport over the Workers VPC binding   |
| [007](../adr/007-shared-fqdn-core-dispatch.md)                        | Implemented; amended by 009, 010      | Shared-FQDN Core dispatch (`worker.ts` as first touch) |
| [008](../adr/008-edge-development-tunnel-exposure.md)                 | Complete                              | Edge development surfaces via the Rails-owned Tunnel   |
| [009](../adr/009-rails-health-entrypoint-and-dispatch-operability.md) | Implemented                           | One health entry point, and an operable Rails dispatch |
| [010](../adr/010-first-touch-rate-limiting.md)                        | Implemented                           | Rate limiting happens once, at first touch             |
| [015](../adr/015-public-content-surfaces-astro.md)                    | Accepted; document layer remaining    | Twelve public surfaces run Astro                       |

Remaining Astro document-CMS work (not a new ADR): [`astro-content-surfaces-remaining.md`](./astro-content-surfaces-remaining.md).

Issue links, where they exist:
[#247](https://github.com/seahal/umaxica-apps-edge/issues/247) (001),
[#248](https://github.com/seahal/umaxica-apps-edge/issues/248) (002),
[#249](https://github.com/seahal/umaxica-apps-edge/issues/249) (003).
