# Edge self-health API (`GET /api/v0/health.json`)

Date: 2026-09-04

## Scope

Implemented the machine-facing Edge self-health JSON document on every active
pnpm workspace deployment unit (20). Operational `text/plain` `/health` probes
were left unchanged. Rails Health API consumption (`rails-health.ts`) was left
unchanged.

## Framework inventory (from package.json, source, wrangler, tests)

| Runtime        | Units                                                      | Evidence                                |
| -------------- | ---------------------------------------------------------- | --------------------------------------- |
| Hono           | `app/apex`, `com/apex`, `org/apex`, `net/apex`, `dev/apex` | `create-apex-app.ts`, `hono` dependency |
| TanStack Start | `app/core`, `com/core`, `org/core`                         | `src/routes/`, `@tanstack/react-start`  |
| Astro          | `{app,com,org}/{docs,help,info,news}`                      | `astro.config.mjs`, `src/pages/`        |
| Next.js        | none active                                                | no `next.config.ts` in workspaces       |
| Other          | `all/busy` is a static Worker, not a pnpm unit             | skipped                                 |

No unit maintains both `src/` TanStack and `src-astro/` as dual targets. Cores
are TanStack only; the twelve content surfaces are Astro only.

## HTTP contract

`GET /api/v0/health.json` → 200, `application/json`, `Cache-Control` contains
`no-store`, `X-Robots-Tag: noindex, nofollow`, no redirect, no `Set-Cookie`.

```json
{
  "status": "pass",
  "checks": {
    "startup": { "status": "pass" },
    "liveness": { "status": "pass" },
    "readiness": { "status": "pass" }
  }
}
```

## Rails-independence

Handlers call `renderHealthApi()` in each unit's `runtime-health` module. They
do not import `rails-client`, `rails-health`, CMS, revision, or bindings.
Core `classifyCorePath('/api/v0/health.json')` is `'next'` so the public FQDN
does not proxy this path to Rails. Remaining `/api/v0/*` stay Rails-owned.

## Caching

Response `Cache-Control: no-store`. Astro middleware forces that header (and
JSON content-type) on this exact path so it is not treated as public GET HTML.
Astro `prerender = false`; `pnpm --dir app/docs run build` prerendered HTML,
manifest, robots, sitemap — not `health.json`. The route is in
`dist/astro/server/chunks/`.

## Hurl

Identical `api/health-api.hurl` in all 20 units (3 requests each: default,
`Accept-Language: ja`, `Accept-Language: en`).

| Command                            | Files | Requests | Result                       |
| ---------------------------------- | ----- | -------- | ---------------------------- |
| `pnpm --dir app/apex run test:api` | 11    | 78       | pass (includes 3 health-api) |
| `pnpm --dir net/apex run test:api` | 11    | 77       | pass                         |
| `pnpm --dir app/core run test:api` | 6     | 29       | pass                         |
| `pnpm --dir com/core run test:api` | 6     | 29       | pass                         |
| `pnpm --dir app/docs run test:api` | 6     | 36       | pass                         |
| `pnpm --dir app/help run test:api` | 6     | 35       | pass                         |

These ran against already-listening local `vite`/`astro dev` servers (Hurl
runner reuse). That is real HTTP, not `app.request()`.

Remaining 14 units received the same Hurl file; they were not all executed in
this session.

## Vitest / static

- `app/apex` `test/health-probes.test.ts` — 6 passed
- `app/core` `test/health-route.test.ts` + `test/core-dispatch.test.ts` — 70 passed
- `app/docs` `test/health-route.test.ts` + `test/middleware.test.ts` — 19 passed
- `vitest run --dir test edge-self-health-invariants.test.ts core-dispatch-contract.test.ts` — 102 passed

## Build / analysis (changed-unit)

- `pnpm --dir app/docs run build` — pass; health not prerendered
- `pnpm --dir app/core run build` — pass; `routeTree.gen.ts` includes `/api/v0/health.json`
- `pnpm --dir app/core run check:size` — 117.86 kB gzipped / 129 kB limit
- knip on `app/apex`, `app/core`, `app/docs` — pass
- oxlint on changed files — pass
- `git diff --check` — pass
- cspell on new ADR/docs/invariants — pass
- `app/docs` `tsc --noEmit` — pass
- `app/apex` `pnpm run typecheck` — pass
- `app/core` `pnpm run typecheck` — **blocked by pre-existing**
  `test/ui-shell-contract.test.tsx` `toHaveAttribute` errors, not in this change

Repository-wide `pnpm run check` was not run to completion.

## Preview / deployment

Not verified. No Cloudflare preview deploy was performed.

## Unverified / risks

- Hurl not executed in all 20 units (6 units executed; 14 share identical files).
- Production Worker preview (`vite preview` / `preview-astro-worker.mjs`) not
  used as a second HTTP target.
- Existing local servers were reused; HMR had to pick up new files (requests
  succeeded, so the route was present).
- Dual TanStack+Astro in one unit does not exist; same Hurl file is used by
  both families across units, not two runtimes of one unit.
