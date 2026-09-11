# AGENTS.md

Edge layer of Umaxica: twelve Astro public content surfaces (`{app,com,org}/{docs,help,info,news}`), three TanStack Start cores, and five apex Hono Workers. All built with Vite (Astro uses Vite internally) and deployed to Cloudflare Workers. Twenty deployment units, one shared script contract.

## Setup & commands

pnpm is the ONLY package manager. Never use npm, npx, yarn, or bun. `pnpm-lock.yaml` is the only lockfile (`test/package-manager-invariants.test.ts` enforces this).

- Install: `pnpm install` (run after every pull, before starting work)
- All static checks + unit tests: `pnpm run check`
- Format: `pnpm run format` / `pnpm run format:check` (Oxfmt)
- Lint: `pnpm run lint` / `pnpm run lint:types` (Oxlint; only `lint:fix` rewrites code)
- Type check: `pnpm run typecheck` (tsc)
- Unit tests: `pnpm run test` (Vitest). Coverage is per-unit (`pnpm --dir <unit> run test:cov`); the root invariant suite does not measure it.
- HTTP tests: `pnpm run test:api` (Hurl)
- Browser tests: `pnpm run test:e2e` (Playwright; run `pnpm exec playwright install chromium` first — CI deliberately skips e2e, do not "fix" that)
- Build: `pnpm run build` (Astro for the twelve content surfaces, Vite for cores and apex)
- Bundle budget: `pnpm run check:size` (requires `pnpm run build` first; NOT part of `check:static`)
- Dead code: `pnpm run knip` · Architecture: `pnpm run check:architecture` · Version sync: `pnpm run check:deps` (`fix:deps` is local-only) · Spelling: `pnpm run check:spelling`
- Per-unit: `pnpm --filter <workspace> run <script>` or `pnpm --dir <unit> run <script>`

Root scripts are `pnpm -r` fan-outs over identical per-unit scripts; every unit runs standalone from its own directory. Exceptions that run once from the root: `check:architecture`, `check:deps`, `check:spelling`.

Root-level `vitest run --dir test` runs only `test/` (repository invariants). There is no root `vitest.config.ts`. A unit's tests live in `<unit>/test/` and run via `pnpm --dir <unit> run test`. Import test utilities from `vitest` directly, never a wrapper.

Before adding a suppression/ignore to any static-analysis tool, read `docs/development/static-analysis-and-hygiene.md` (normative).

## Per-unit config — do not centralize

Each deployment unit owns its own `.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, and `knip.jsonc`. Never replace a unit's copy with a root `extends` or shared package (`test/deployment-unit-boundaries.test.ts` enforces this). Root `.oxlintrc.json`, `.oxfmtrc.json`, and `tsconfig.json` apply to repo-level files only.

## Build & deploy

`vite build` produces the deployed Worker bundle and hashed assets — it builds for production, not just dev. Vite is a devDependency because it doesn't run _in_ production; CI cannot drop the build step. Production starts no Node process and no server. `adr/012-apex-vite-build-and-static-assets.md` is normative.

## Test layers — placement by assertion, not by tool capability

| Layer           | Tool       | Lives in       | Answers                            |
| --------------- | ---------- | -------------- | ---------------------------------- |
| `pnpm test`     | Vitest     | `<unit>/test/` | did the internal logic break?      |
| `pnpm test:api` | Hurl       | `<unit>/api/`  | did the HTTP contract break?       |
| `pnpm test:e2e` | Playwright | `<unit>/e2e/`  | did the user's browser path break? |

- Assertion on a **response** (status, headers, body, cookies, redirects) → `.hurl` file against a real server. Must NOT import from `src/` or call `app.request()`.
- Assertion **no HTTP client can produce** (a route that throws, injected `RATE_LIMITER`, a Workers binding, a `console` line) → Vitest. `app.request()` is allowed only as the driver — say so in a comment.
- Assertion needing a **real engine** (rendering, accessibility tree, service worker, offline) → Playwright. Status codes and `Content-Type` never belong in a `.spec.ts`.
- Duplicating a behaviour across layers is allowed only when each layer fails for a different reason (e.g. auth flow in Hurl + JWT parser in Vitest + login screen in Playwright). The same `GET /health → 200` in all three is not.

`test:api` self-hosts: each unit's `api/run.mjs` spawns `pnpm run dev`, runs Hurl, stops it; it reuses an already-listening server. `EDGE_API_BASE` targets a deployment instead. See each unit's `api/README.md`.

All twenty units implement the same contract, including `dev/apex`; none is exempt.

## Evidence

Completed tests, validations, verifications, audits, security checks and
performance checks leave a short record in `evidence/` when retaining the result
is useful. Records describe work that was actually performed — never plans,
intentions, or unverified claims. A check that could not be completed is
recorded as such, with the reason and whatever was observed.

- `evidence/` is flat; no subdirectories.
- Only `.md` files.
- `YYYY-MM-DD-<topic>.md`, ISO date, lowercase hyphenated topic.
- No raw logs, screenshots, binaries, archives, dumps, generated reports or
  other large artifacts. Summarize them, and cite the commands, identifiers,
  hashes, measurements and excerpts that carry the result.
- Enforced by `pnpm run test` (`test/evidence-layout.test.ts`).

## Logging

`no-console` is an **error** in every unit. Never call `console` directly or add a new disable comment. The only two sanctioned emitters (closed, typed surfaces):

- `*/apex/src/structured-logger.ts` — `@hono/structured-logger` middleware, wired in `create-apex-app.ts`
- `*/core/src/lib/rails-dispatch-log.ts` — the Edge → Rails hop (public internet, `RAILS_ORIGIN`)

Both emit one JSON line `{ level, msg, data }`, collected by `observability.logs.enabled` in each `wrangler.jsonc`. No external observability vendor; adding one is a decision, not a detail.

`RailsDispatchLogEntry` has no free-text field by design — every value is a number or a fixed union, so secrets (cookies, tokens, bodies, user ids, hostnames) cannot leak into a log line. Add new fields as closed unions; never widen one to `string`.

## Cookies

Browser code touches cookies ONLY via the Cookie Store API (`cookieStore`). No cookie library, no `document.cookie`, no wrapper module before a feature needs one. Server side is unaffected: Hono's `hono/cookie`, the apex `languageDetector`, and Rails cookies all stay as they are.

Boundary consequence (ADR 007): `*/core/src/worker.ts` strips every `Set-Cookie` from application responses — a browser-visible cookie can only be issued by an apex worker or by Rails, never by a frame.

`docs/development/browser-cookie-access.md` is normative — read it before writing any browser cookie code.

## Styling

Tailwind CSS v4 is the only styling layer. No CSS Modules, no CSS-in-JS, no `tailwind.config.*`, no static `style=` attribute. `docs/design/ui-shell-contract.md` §3a is normative.

- Each unit owns its own stylesheet with its own `@theme` — no shared preset (enforced by `test/deployment-unit-boundaries.test.ts`).
- Engine runs via `@tailwindcss/vite`; there is no `postcss.config.mjs` and `@tailwindcss/postcss` is not installed. Vite fingerprints the stylesheet into `dist/client`, which lets `public/_headers` mark `/assets/*` immutable. Each unit names the URL once in `src/assets.ts`.
- Visual rules are utilities in markup. A new CSS rule needs a written reason a utility can't express it; `@apply` is never that reason. Repeated utility runs become a component, not a class.
- Design constants are `@theme` tokens; `--color-brand` is the one colour pinned by literal value.

## Generated files

- `cloudflare-env.d.ts` (frames) and `worker-configuration.d.ts` (apex) come from `wrangler types` and are **gitignored — never commit them**. Frames run `cf-typegen` inside `typecheck`; apex workers compile without the file.
- `src/routeTree.gen.ts` **IS committed** in every frame (regenerated by the TanStack Router plugin on `vite dev`/`vite build`; excluded from Oxfmt, Oxlint, and coverage). Rationale: `adr/013-frames-tanstack-start.md`.

## Module composition

- Mixin-style modules, shared helpers, and composition utilities MUST stay side-effect-light: mutations, registration, persistence, and I/O are wired explicitly by the caller.
- Export the smallest surface practical; keep internals unexported unless intentionally part of the consumer-facing API.

## Design principle

YAGNI. Build only what is needed now; no speculative abstractions.

## Review checklist

- [ ] `pnpm install` after pulling, before starting.
- [ ] `pnpm run check` before finishing any change.
- [ ] `pnpm run build && pnpm run check:size` if the change reaches a browser bundle.
- [ ] `pnpm run test:api` if the change is client-observable (route, header, redirect, status, rendered document).
