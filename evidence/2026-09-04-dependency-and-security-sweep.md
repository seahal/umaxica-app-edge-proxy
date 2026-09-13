# Dependency refresh, security/performance sweep, coverage raise

Date: 2026-09-04

## Scope

Requested sequence: pull latest, `pnpm update`, judge health via `pnpm outdated`,
review the codebase for vulnerabilities/performance issues and fix any found,
raise coverage, and confirm no linter/formatter problems remain.

## 1. Latest and dependency update

- `git pull --ff-only`: already up to date (`feature` = `origin/feature` =
  `8b8eb720`).
- `pnpm install` (pre-update): no-op, lockfile already current.
- `pnpm update -r`: 24 packages bumped inside their existing catalog ranges.
  Notable: `cspell` 10.2.0→10.2.1, `@types/react-dom` 19.2.5→19.2.7,
  `@cloudflare/workers-types` → `^5.20260903.1`, `happy-dom` → `^20.13.2`.
  `pnpm-lock.yaml` and the version literals inside `pnpm-workspace.yaml`
  catalog comments updated to match; no catalog _range_ was widened.
- `pnpm outdated -r` after update: no output (nothing outdated within policy).
- `pnpm audit --audit-level low`: 1 high, 1 ignored — `GHSA-jmr9-qjv8-65gv`
  (`extract-zip`, pulled in only by `@orangeopensource/hurl`'s install script).
  Re-verified via `pnpm view extract-zip versions`: npm's newest published
  version is still `2.0.1`; the advisory's fix floor `2.0.2` has never been
  published. Exception left in place, matching its existing comment.

## 2. `minimumReleaseAgeExclude` cleanup

`pnpm-workspace.yaml` carried four temporary exceptions, three explicitly
commented "remove once aged past the window (after 2026-09-04)" — today.
Checked registry publish timestamps directly:

| Package                      | Published (UTC)      | Aged past 1440 min by 2026-09-04T14:56Z? |
| ---------------------------- | -------------------- | ---------------------------------------- |
| `astro@7.3.1`                | 2026-09-03T13:29:45Z | yes                                      |
| `@astrojs/cloudflare@14.3.0` | 2026-09-03T10:29:13Z | yes                                      |
| `vitest@5.0.0` / `@vitest/*` | 2026-09-03T12:24Z    | yes                                      |

Removed all three (plus `miniflare@5.20260804.0-alpha`, which the lockfile no
longer resolves — it excepted nothing). Verified `pnpm install` still passes
`minimumReleaseAgeStrict: true` against all 854 lockfile entries with the list
empty. `minimumReleaseAgeExclude: []` now, with the reasoning kept in the
file's own comment.

## 3. Vulnerability / performance review

Reviewed the two most recent commits (`272d0911` self-health API, `8b8eb720`
revision API), which touch all 20 units identically. One finding, fixed;
everything else checked out.

### Finding: readiness probes throttleable but not rate-limited (fixed)

`isHealthPath()` (Cores' `worker.ts`), the apex middleware's machine-endpoint
list, and the Astro middleware's prerender guard all exempted `/health` and
`/health/readinesses` from the rate limiter alongside the three constant
probes (`startup`, `liveness`, `/api/v0/health.json`). Both `/health` and
`/health/readinesses` fetch Rails over the Workers VPC binding
(`rails-health.ts`), so the exemption gave an unauthenticated caller an
uncounted, one-request-in/one-request-out path into the private Rails origin —
the rate limiter is the only thing standing between a public request and that
hop for every other route.

Fix, applied identically across all 20 units: split "paths that must render
without limiter overhead" into two sets. `isUnmeteredProbe` /
`UNMETERED_PROBES` now covers only the three constant-answer probes
(`/health/startups`, `/health/livenesses`, `/api/v0/health.json`); `/health`,
`/health/readinesses`, `/revision`, and `/api/v0/revision.json` are metered
like any other route. A wider `isHealthPath` / `isMachineEndpoint` set (still
including the Rails-backed probes) is kept where it drives something other
than the limiter — non-ASCII header stripping in Cores, language-detector
skip in apex — since those concerns don't create the same exposure.

Verified with new test cases per family (`worker.test.ts` ×3,
`health-probes.test.ts` ×5) asserting `/health`, `/health/readinesses`,
`/revision`, `/api/v0/revision.json` each still consult the limiter exactly
once, and the three constant probes still do not.

### Checked, no change needed

- **No information leakage**: `version-metadata.ts` and `runtime-health.ts`
  return only `{id, tag, timestamp}` / fixed probe literals — no hostnames,
  binding names, or exception text.
- **`readProxyErrorCode`** only reads a response body on the failing path
  (`status === 500`, `text/plain`), via a `clone()`, bounded by
  `readBoundedText`. The success path never touches the body.
- **Cookie boundary (ADR 007)**: `worker.ts` strips inbound `Cookie` and
  outbound `Set-Cookie` around the application half regardless of path; the
  new revision/health-api routes go through the same strip.
- **`classifyCorePath`**: `/api/v0/health.json` and `/api/v0/revision.json`
  are matched by exact equality before the `/api/v0/` Rails-owned prefix
  check, so no other `/api/v0/*` path is shadowed.
- **`pnpm run build && pnpm run check:size`**: ran clean, no bundle-budget
  regression (see §5).

### Incidental fix: a stale test guard flagged the health API as a regression

`test/tunnel-surface-identity.test.ts`'s apex guard asserted
`not.toContain('/health.json')` as a bare substring, which
`'/api/v0/health.json'` (added by ADR 017) satisfies — the guard was failing
on every apex unit, reporting a violation the code does not commit. Narrowed
the assertion to the quoted path literal `'/health.json'` it was meant to
catch (the ADR 009 root-level document Rails owns), and pinned that the
mandated `/api/v0/health.json` route is still registered.

### Incidental fix: root test suite was failing before any of the above

`compose.override.yaml.example` was absent from the working tree (its
deletion was never committed — `git log` shows it present at parent of
`4f096943`) while three tests (`test/compose-local-override-invariants.test.ts`,
`test/compose-tunnel-invariants.test.ts`, `test/development-container-security.test.ts`)
still read it. Restored the tracked file from `4f096943^` and `git add`ed it;
content is unchanged from what those tests, `README.md`, and
`docs/development/container-security-policy.md` already documented.

## 4. Coverage

Measured `pnpm --dir <unit> run test:cov` for all 20 units before any test
changes. Four archetypes (apex ×5, Core ×3, Astro docs/help/info/news ×12)
were below their 100%-lines/99%-branches thresholds — none were failing the
threshold gate, but branches ranged 95.7–99.4%. Added tests for real gaps
(never widened `coverage.exclude`, never asserted an HTTP contract from
Vitest per the test-layer rule in `AGENTS.md`):

- `rails-health.ts` (Core + Astro, 15 units): the parser's rejection arms for
  a non-object document, a non-object `checks`, an unknown check status, a
  response with no declared content type, an oversized body, and a body whose
  stream errors mid-read. Also removed one genuinely unreachable branch
  (`split(';')[0] ?? ''` under `noUncheckedIndexedAccess`) by rewriting the
  media-type split without an indexed access that can't be undefined.
- `runtime-health.ts` (Core + Astro, 15 units): narrowed `ProbeName` from
  `'startup' | 'liveness' | 'readiness'` to `'startup' | 'liveness'` —
  `renderProbe('readiness')` was dead code; every call site that renders
  readiness goes through `renderProbeStatus` with a value already composed
  from the Rails check. This removed the last-arm branch rather than testing
  around it.
- apex `runtime-health.ts` (5 units): added a mocked-readiness-failure case to
  `health-probes.test.ts` to cover the aggregate's `error` branch — no HTTP
  client can produce this from a live isolate, matching the file's own
  documented test-layer rule.
- Astro `rails-entries.ts` (12 units): `invalid-path` mapping to
  `upstream-error` without leaking the internal reason, and pagination
  stopping at the first non-ok page rather than the partial list.
- Astro `cms/client.ts` (4 units with the CMS pilot): the two
  `parseCmsDocument` rejection reasons (`body_missing_or_invalid`,
  `schema_mismatch`) reached through well-formed-but-wrong-shape JSON.
- Astro `middleware.ts` (12 units): `/revision` no-store/header-stamping arm,
  parallel to the existing health-probe and self-health-API cases.

Post-fix `test:cov` for all 20 units: 100% statements/branches/functions/lines.
Raised `thresholds.branches` from `99` to `100` in all 20 `vitest.config.ts`
files to hold that level (statements/functions/lines were already pinned at
100).

## 5. Final verification

- `pnpm run test`: all units + root invariant suite green
  (562 passed, 1 skipped at root; 20/20 units 100% coverage).
- `pnpm run check` (format:check, lint, lint:types, check:generated,
  typecheck, knip, check:workers, check:architecture, check:deps,
  check:spelling, test): green. Along the way, found and fixed pre-existing
  lint failures unrelated to this session's edits — `oxlint` had never
  actually run to completion locally because `format:check` was failing first
  on the missing `compose.override.yaml.example` (see §3). Fixed:
  - `e2e/revision.spec.ts` (all 20 units, byte-identical),
    `test/revision-binding.test.ts` (apex ×5),
    `test/revision-route.test.ts` (Astro docs family ×12),
    `test/status-surfaces.test.tsx` (Core ×3): `eslint(require-unicode-regexp)`
    — added the `u` flag to regex literals introduced with the revision API
    work; one `no-useless-escape` (`[\[{]` → `[[{]`, unnecessary inside a
    character class).
  - `tools/verify-edge-connectivity.mjs`: two `require-unicode-regexp` and two
    `eqeqeq` (`kind == null` → `kind === null`).

  Clearing that also exposed pre-existing failures further down the
  `check:static` chain, likewise never reached locally before:
  - `lint:types` — `app/docs/src/pages/cms-bootstrap-probe.json.ts`:
    `typescript(no-unsafe-type-assertion)` on `binding as { fetch: typeof
fetch }`. Replaced the cast with a `hasFetchBinding` type predicate so the
    compiler confirms the shape instead of asserting it.
  - `typecheck` — `e2e/revision.spec.ts` (all 20 units): `exactOptionalPropertyTypes`
    rejected passing `headers: undefined` explicitly to Playwright's request
    options; fixed by conditionally spreading `headers` instead of always
    assigning the key. Astro `rails-entries.ts` (12 units): `isTimeout`'s
    `Reflect.get(result, 'kind') === 'timeout'` hit TS2367 ("no overlap") once
    typecheck ran this far, because `Reflect.get`'s literal-key overload
    narrows to `RailsClientResult['kind']`, which does not include
    `'timeout'` — that value is Astro's own transport signal layered on top
    at the `rails-client.ts` seam. Fixed by reading through an explicit
    `const kind: unknown` binding, matching the same idiom already used in
    `core-dispatch.ts`'s `isTimeoutError`.
  - `typecheck` — `app/{apex,core}`, `{com,org}/{apex,core}`, `net/apex`,
    `dev/apex` (8 units): every `vitest.setup.ts` imported the package-root
    `@testing-library/jest-dom` rather than its `/vitest` subpath. Root-export
    type augmentation targets a generic `expect` interface that no longer
    matches Vitest 5's `Assertion<T, R>` shape, so `toHaveAttribute`,
    `toHaveFocus`, etc. were invisible to `tsc` on `expect(element)` — while
    still registered and passing at runtime, confirmed by running each unit's
    test suite before and after the import fix. Same matcher set, correct
    subpath.
  - `check:spelling` — `evidence/2026-09-04-tunnel-token-single-variable.md`:
    unknown word `umaxicaappsglobaldc`, the Podman-derived Compose project
    name for the sibling Global/Rails repository, quoted verbatim from an
    observed tunnel-connector conflict. Added to
    `.cspell/project-words.txt` rather than reworded — it's a real identifier
    from an operator's terminal output, not a typo.

  None of these five were reachable by the change this session made; each
  was uncovered only because the chain now gets past the step before it.

- `pnpm run build && pnpm run check:size`: build clean across all units,
  bundle budgets within limit.

## Not run

- `pnpm run test:e2e`: out of scope per `AGENTS.md` ("CI deliberately skips
  e2e, do not fix that"); not run here either.
- `pnpm run test:api`: the rate-limiter exemption fix is client-observable
  (status codes on `/health`, `/health/readinesses`, `/revision`,
  `/api/v0/revision.json` when throttled). Not executed in this pass — each
  unit's `api/run.mjs` self-hosts a dev server per unit, which is expensive to
  run across 20 units in this environment. Flagged as the one remaining
  verification step before merge.
