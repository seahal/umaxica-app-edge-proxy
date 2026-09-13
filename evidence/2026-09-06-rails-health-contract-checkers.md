# Rails health contract: closed across every implementation that checks it

Date: 2026-09-06

Repository: `umaxica-apps-edge`, branch `feature`, on top of `253ec3ab`.

## Why

`253ec3ab` made `timestamp` a required, timezone-aware field of Rails'
`/api/v0/health.json` in the fifteen `src/lib/rails-health.ts` copies, with
tests. Nothing moved with it. Auditing outward from that commit found the change
had landed in the Worker alone, and then found a second, older blind spot in the
same area.

### Gap 1 — the `timestamp` requirement existed in one place

| Place                                                 | Before                                       |
| ----------------------------------------------------- | -------------------------------------------- |
| `*/*/src/lib/rails-health.ts` (×15)                   | requires `timestamp` (`253ec3ab`)            |
| `scripts/check-rails`                                 | did not — a timestamp-less Rails read `PASS` |
| `tools/verify-edge-connectivity.mjs`                  | did not — no contract gate at all            |
| `adr/016-rails-machine-health-api.md`                 | required set listed without `timestamp`      |
| `adr/017`, `docs/development/edge-self-health-api.md` | claimed Edge and Rails share one DTO shape   |

Two operator-facing checkers would have reported a green connection while every
frame reported readiness `error` and served `/health` 503.

### Gap 2 — the checker had stopped reading the Rails half at all

`tools/verify-edge-connectivity.mjs` read the Rails half out of a JSON `/health`
document at `rails.liveness.kind`. ADR 016 moved the probes to `text/plain`, so
`parseRailsHealthJson()` matched nothing on any of the twenty units, every
caller took its `null` branch, and three gates reported

```text
SKIP  runtime /health is text/plain and does not carry Rails
```

for fifteen surfaces, permanently. It does carry Rails: `readiness:` in the
aggregate body is `edgeReadinessFromRails(checkRailsHealth(...))` verbatim
(`src/routes/health.ts`, `src/pages/health.ts`). Every branch behind that SKIP —
`not-configured`, `ok`, the mismatch check — was unreachable, and
`railsHealthStatusMismatch()` was never called with a non-null kind.

## What changed

Gap 1:

- `scripts/check-rails` — the same timezone-aware `timestamp` requirement, regex
  literal byte-identical to the Worker's.
- `tools/verify-edge-connectivity.mjs` — new exported `classifyHealthContract()`
  and a `VPC contract` gate recorded per surface in the `vpc` tier, with a
  summary note naming the 503 consequence.
- `test/rails-connection-invariants.test.ts` — invariant pinning the
  required-field set and the timestamp regex across all three implementations.
- `adr/016` — amendment recording `timestamp` as required and `namespace` as
  additive-and-tool-only.
- `adr/017`, `docs/development/edge-self-health-api.md` — record that the Edge
  self-health document deliberately carries no `timestamp` (already asserted by
  `api/health-api.hurl`), so `rails-health.ts` is not a parser for it.

Gap 2, all in `tools/verify-edge-connectivity.mjs`:

- `parseRailsHealthJson()` and `railsHealthStatusMismatch()` replaced by
  `readEdgeReadiness()` and `healthStatusMismatch()`, which read the
  `text/plain` document the units actually serve.
- `Local /health rails` and the preview tier's Rails gate now report a
  measurement instead of a permanent SKIP.
- `Local /health` now reads `startup` + `liveness` for the Edge half rather than
  the aggregate `status` line. `status` folds in `readiness`, so a Rails outage
  used to fail the gate that names the Edge half; the two halves now sit in
  their own gates.
- Gate tables corrected: `VPC identity` was in neither `GATE_ORDER` nor
  `GATE_ABBREVIATIONS`, so it sorted last and rendered as the truncated header
  `VPC i`; `Preview /health rails` and `Preview(vpc) /health rails` were in
  `GATE_ORDER` but recorded nowhere.

No unit's `src/` changed. The fifteen `rails-health.ts` copies are untouched.

## Resolution limit, recorded rather than papered over

`readiness: ok` cannot name the kind. ADR 016 decision 4 maps `pass`, `warn`
**and** `not-configured` all onto `ok`, so the `text/plain` document proves a
frame is serving but cannot distinguish a healthy Rails from an absent binding.
The rewritten gates therefore state which kind was expected for the tier rather
than claiming to have measured which one they got. That is a real loss of
resolution against the JSON document ADR 009 built, and it is the reason the
`vpc` tier's new `VPC contract` gate reads Rails' own document directly.

## Verified

- `pnpm run check` — pass, exit 0. That is `check:static` (format, oxlint,
  type-aware oxlint, `check:generated`, tsc, knip ×20, `check-workers` 20/20,
  depcruise, syncpack, cspell 1999 files) followed by `pnpm run test`.
- `pnpm run test` — all twenty units pass; root `vitest run --dir test` is
  567 passed / 1 skipped, from 562 / 1 at `253ec3ab`. The skip is the
  pre-existing `compose-local-override-invariants` case needing a container
  engine.
- Drift detection confirmed by mutation, not only by a green run: narrowing the
  regex in `scripts/check-rails` to `(?:Z)` made
  `rails-connection-invariants.test.ts` fail with
  `scripts/check-rails has no timestamp pattern`. Reverted.
- `classifyHealthContract()` was exercised against the exact body recorded in
  `evidence/2026-09-05-workers-vpc-namespace-identity.md` (HTTP 200, correct
  `namespace`, no `timestamp`) and returns FAIL naming `timestamp`.

## Not verified

- **No live Rails was reached, and no gate was run against a server.** No
  `podman` on this host and nothing listening on `core.app.localhost:3000`, so
  `scripts/check-rails` and `tools/verify-edge-connectivity.mjs` in modes `vpc`,
  `next` and `preview` were not executed. Both changed gates are proven by unit
  test only. The rewritten `Local /health rails` and preview gates have never
  produced a real cell.
- **Whether Rails emits `timestamp` today is unknown.** The last document
  observed from this repository
  (`evidence/2026-09-05-workers-vpc-namespace-identity.md`, same day, earlier)
  carried `status`, `checks` and `namespace` and **no `timestamp`**. If that is
  still the shape, the requirement added in `253ec3ab` puts all fifteen frames
  at readiness `error` / `/health` 503. This record does not resolve that; it
  makes the checkers say so instead of reporting green.
- `pnpm run test:api`, `test:e2e`, `build` and `check:size` were not run: no
  unit's `src/` changed and no HTTP-observable behaviour of any of the twenty
  units changed.
