# HTTP contract tests

`pnpm run test:api` runs every `.hurl` file in this directory against a running
server with [Hurl](https://hurl.dev).

```sh
pnpm run test:api                      # starts a server, runs the suite, stops it
pnpm run dev &&  pnpm run test:api     # or reuse one you already have
```

`api/run.mjs` owns the server. Hurl is a standalone binary with no equivalent of
Playwright's `webServer` block, so something has to put a server in front of it,
and leaving that to the reader makes `pnpm run test:api` mean different things
in different terminals — which is the one thing a contract suite cannot afford.

It is deliberately **not** a third owner of process lifecycle. It probes the
port first and reuses whatever is already answering, exactly as
`playwright.config.ts` does with `reuseExistingServer`; it only starts a server
when nothing does, and then it stops the whole process group it started. Running
`pnpm run dev` in another terminal therefore behaves as it always did.

Set `EDGE_API_BASE` to run these files against a preview deployment. Nothing is
started or stopped in that case — a remote target is not ours to manage — and a
target that does not answer is an error rather than a reason to fall back to
localhost.

The runner is duplicated per unit rather than shared from the repository root,
for the same reason every unit owns its `vitest.config.ts`: a suite that only
runs from the root is not extractable. `test/deployment-unit-boundaries.test.ts`
enforces that.

## What belongs here

The three test layers in this repository are split by responsibility, not by
capability:

| layer           | tool       | answers                                      |
| --------------- | ---------- | -------------------------------------------- |
| `pnpm test`     | Vitest     | did the internal logic break?                |
| `pnpm test:api` | Hurl       | did the HTTP contract break?                 |
| `pnpm test:e2e` | Playwright | did the user's path through a browser break? |

A file here asserts what an HTTP client can observe and nothing it cannot:
status, headers, body structure, and the semantic values inside the body. It
does not import from `src/`, and it does not call a route handler — importing the
server route from `src/routes/health.ts` and awaiting it is a component-level
tool, and using it here would erase the boundary this directory exists to draw.

The reverse also holds: a Vitest file may still invoke a server route or the
request boundary directly when the thing under test is **not** reachable over
HTTP — a stubbed `fetch` that makes Rails time out, a rate limiter that
refuses, a Workers binding. There the call is the driver and the assertion is
elsewhere. When the assertion is on the response itself, it belongs here.

## Why a real client finds things an in-process call cannot

Calling a route function directly builds a bare `Request` and returns a bare
`Response`: no connection, no cookie jar, no server entry, no rate limiter and no
state between calls. Most of what this directory asserts is invisible from there.

`security-headers.hurl` is the clearest case. The headers come from
`securityHeaders()` in `security-headers.ts`, applied by `withSecurityHeaders()`
at the request boundary, and the test this file replaced imported the first
function and checked the array it returned — which is to say, it checked that a
literal equals itself. Nothing in it went through the wiring, so it would have
stayed green if that wiring had been deleted outright.

One assertion did come back to Vitest, in
`test/content-security-policy.test.ts`, and the reason is the mirror image:
`script-src` carries `'unsafe-eval'` under `vite dev` and must not carry it in a
build, and the server this runner starts is a dev server. The development policy
is asserted here, on a real response; the production one is unobservable from
here at any depth, so the branch that produces it is asserted there instead.

## Conventions

- `{{base}}` is supplied by `api/run.mjs` (`--variable base=…`) rather than
  hardcoded, so the same files can run against a preview deployment.
- Assert in depth — status, then headers, then body structure, then the values
  that carry meaning. A file full of bare `HTTP 200` checks costs a CI job and
  proves that the process is up.
- Prefer asking the server over restating it: request a linked destination
  rather than comparing it against a list that has to be kept in step by hand.
- Pin key SETS, not just key presence. `jsonpath "$.x" exists` cannot see an
  added field, and these payloads are read by machines, so `jsonpath "$.*"
count == n` is the assertion that catches a schema change in either direction.
- `/health` here is a UNIFIED document — this frame's own state and Rails'
  liveness — and it answers 503 when Rails is absent, which is correct rather
  than broken. `standard-contract.hurl` therefore uses `HTTP *` and asserts the
  shape plus this frame's own half; the branches Rails can drive are unit-tested
  against a stubbed `fetch`, the only layer that can produce them on demand.
