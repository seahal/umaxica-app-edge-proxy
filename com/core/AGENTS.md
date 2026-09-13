# This unit is TanStack Start on Vite

`com/core` builds with Vite and `@cloudflare/vite-plugin` and runs on workerd, like
every one of the twenty deployment units in this repository. Every frame runs the
same stack, so a pattern copied from a sibling frame is current.

What a sibling can differ in is **archetype**. This unit is a Core: its shell
sits on the pathless `src/routes/_page.tsx` layout route, so `/offline`, the 404
and the 500 render **outside** it and are chrome-free. The twelve satellites wire
their shell into `src/routes/__root.tsx` instead, so their failure documents
carry the header, the footer and the skip link. Check which one you are reading
before copying a route or a shell change; `docs/design/ui-shell-contract.md` §15
is normative.

TanStack Start is at Release Candidate, and its API moves quickly. Read the
current documentation rather than working from memory:

- <https://tanstack.com/start/latest/docs/framework/react/overview>
- <https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management>
- <https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/>

## What is load-bearing here

- **Health is four `text/plain` server routes**, not JSON and not a React page:
  `/health` (human aggregate), `/health/startups`, `/health/livenesses`,
  `/health/readinesses`. They skip the generic rate limiter (exact pathname
  only). Rails JSON under `/health/*.json` stays blocked in `core-dispatch.ts`.
- **`src/worker.ts` is the entrypoint, not the framework.** wrangler's `main` is
  this file. It classifies the path, rate-limits once, dispatches Rails-owned
  paths to Rails at `RAILS_ORIGIN` over the public internet (no Workers VPC —
  `adr/018-core-rails-direct-internet.md`), and strips `Cookie` in and `Set-Cookie` out around
  whatever answers the rest — `adr/007-shared-fqdn-core-dispatch.md`. The
  migration did not change it; it changed who "the rest" is. That seam is
  `src/lib/app-handler.ts`, which is why `worker.ts` names a module rather than a
  framework. **A cookie the browser can see cannot be issued from this
  application half** — `Headers.delete()` removes every value, so a route that
  sets one works locally and emits nothing through the Worker.
- **Security headers are applied in `src/lib/app-handler.ts`, not in
  `src/worker.ts`.** They belong to documents this application renders. A
  Rails-owned response is Rails' to header, and moving them up would have Edge
  silently rewrite Rails' policy.
- **`src/lib/app-handler.ts` uses `defaultRenderHandler`, not
  `defaultStreamHandler`.** Streaming flushes the shell before a failure is
  known, so a thrown error produced a 200 with no `<title>` and no error
  document. Rendering to a string first is what makes the 500 real. A route
  _component_ that throws still answers 200 — put failure paths in loaders.
- **`src/routes/__root.tsx` declares no `title`.** `<HeadContent />` renders the
  head tags of every matched route and React hoists a `<title>` a component
  renders on top of that, so a root title plus a failure document's own title
  serves TWO `<title>` elements — and `api/title-contract.hurl` asserts there is
  exactly one. Every route owns its title; `src/lib/title.ts` composes the suffix.
- **Flat routing can make a sibling into a parent.** `_page.configuration.tsx`
  became the parent of `_page.configuration.account.tsx`, which renders no
  `<Outlet />`, so the child silently rendered the parent's page with the correct
  URL and the correct title. It is `_page.configuration.index.tsx` for that
  reason, and `test/pages-smoke.test.tsx` compares every page's `<h1>` against its
  dictionary entry so it cannot recur. **Name a leaf `.index.tsx` when a sibling
  route extends its path.**
- **`typescript/only-throw-error` is off in exactly two files**, named in
  `.oxlintrc.json`. TanStack's `notFound()` and `redirect()` return plain objects
  for the caller to throw. Do not widen that scope, and do not add an inline
  directive — the rule is type-aware only, so `pnpm run lint` would report the
  directive itself as unused.
- **Rails is `RAILS_ORIGIN` in `wrangler.jsonc`, per tier — never a constant in
  code.** `src/lib/rails-origin.ts` accepts a bare https origin, or plain http
  only for a `*.localhost` host; anything else is "not configured" and fails
  closed to 503. No tier names one yet; locally, set it in `.dev.vars` (see
  `.dev.vars.example`).
- **No `assets.directory` in `wrangler.jsonc`.** `vite build` writes it into the
  output config; see `adr/012-apex-vite-build-and-static-assets.md`.

`adr/013-frames-tanstack-start.md` is the decision record, including what got
worse and the four constraints this stack is used under.
