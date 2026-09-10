# Vitest architecture hardening

Date: 2026-09-07

Hardening of the Vitest layer across all twenty deployment units. Deployment-unit
independence is preserved: every change is duplicated into each unit's own
`vitest.config.ts` / `package.json`, no root shared Vitest config or shared
config package was introduced, and `test/deployment-unit-boundaries.test.ts`
still passes.

## Previous architecture

- Twenty identical-by-convention `vitest.config.ts` files, each self-contained.
- `environment: 'happy-dom'`, `globals: true`, `provider: 'v8'`, coverage
  thresholds 100/100/100/100 (not `perFile`).
- No explicit execution-contract settings: `retry`, `isolate`,
  `fileParallelism`, `maxWorkers`, `maxConcurrency`, `mockReset`,
  `restoreMocks`, `unstubEnvs`, `unstubGlobals`,
  `dangerouslyIgnoreUnhandledErrors`, timeouts and `slowTestThreshold` were all
  left at Vitest defaults.
- Root `pnpm run test` fanned out with the implicit pnpm
  `--workspace-concurrency` (4) and no per-unit worker bound, so the effective
  worker ceiling tracked the host core count.
- `cloudflare:workers`, `astro:env/client`, `astro:middleware` and
  `@tanstack/react-start/server-only` resolved to per-unit mock modules under
  `test/__mocks__/`.
- No stress / shuffled-order mode.

## Blocked: Cloudflare Workers runtime (workerd) layer

The intended migration to `@cloudflare/vitest-plugin` (`cloudflareTest()` +
each unit's own `wrangler.jsonc`, executing in workerd/Miniflare) is **blocked by
a peer-dependency conflict** and is deferred, not abandoned.

- This repository is on **Vitest 5.0.0** (catalog-pinned; deliberately upgraded
  2026-09-03, with `@vitest/coverage-v8` pinned to exact `5.0.0`).
- Every published `@cloudflare/vitest-plugin` version through the current
  `1.1.4` (2026-09-03) declares `peerDependencies` `vitest`, `@vitest/runner`
  and `@vitest/snapshot` all `^4.1.0`. The predecessor
  `@cloudflare/vitest-pool-workers@0.22.0` is identical.
- `minimumReleaseAge` is not the blocker: `1.1.4` has aged past the 1440-minute
  window. The blocker is the `^4` peer range against the repo's Vitest 5.

Options considered: (a) downgrade the whole catalog to Vitest 4 — rejected, it
reverts a deliberate, days-old upgrade for one test layer; (b) a second
Vitest-4 sub-project per unit — rejected, two Vitest majors resident per unit
for no immediate test; (c) defer the workerd layer, keep the mocks, harden
everything else on Vitest 5 — **chosen**.

Re-evaluate when `@cloudflare/vitest-plugin` publishes a `vitest@^5` peer. The
migration is then mechanical: add `vitest.workers.config.ts` per unit that owns
Worker-runtime assertions, move the category-C mock behaviour (below) onto real
`env` / bindings, and switch those suites' coverage to
`@vitest/coverage-istanbul` (native V8 coverage is unsupported through the
plugin).

## New test layers

The layer boundary from `AGENTS.md` is unchanged and refined:

| Layer          | Tool                         | Answers                                          | Status                                           |
| -------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Vitest Node    | Vitest + happy-dom           | internal/pure logic; impossible-to-observe paths | hardened                                         |
| Vitest workerd | `@cloudflare/vitest-plugin`  | Workers runtime APIs, bindings, isolation        | **deferred** (Vitest 5 peer conflict)            |
| Vitest Browser | `@vitest/browser-playwright` | isolated real-DOM component/focus/keyboard       | **deferred to an explicit decision** (see below) |
| Hurl           | Hurl (`<unit>/api/`)         | real HTTP response contract                      | unchanged                                        |
| Playwright E2E | Playwright (`<unit>/e2e/`)   | full browser user journey                        | unchanged                                        |

No HTTP-contract assertion was moved into Vitest. No assertion was duplicated
across layers.

### Vitest Browser Mode — deferred to an explicit decision

Only the three Cores (`app/core`, `com/core`, `org/core`) have browser React
UI; the twelve Astro content units render `.astro` (no React components) and the
five apex Workers render with `hono/jsx` and have no browser UI, so a browser
project for them would be symmetry for its own sake, which the task rules out.

The Cores already have real component tests (`route-announcer.test.tsx`,
`app-shell.test.tsx`, `status-surfaces.test.tsx`, …) driving Testing Library +
a real memory-history TanStack router under happy-dom. Moving the focus- and
keyboard-sensitive subset to Vitest Browser Mode (Playwright provider, headless
Chromium) is worthwhile, but it requires a Chromium binary in CI and the
`Containerfile`. The existing CI comment on `test:e2e` states that adding a
browser binary "stays a documented local gate until that is a decision someone
makes on purpose." Introducing `@vitest/browser-playwright` + Chromium to CI
crosses that same line and is therefore raised as a decision rather than made
here. The setup when taken:

- add `@vitest/browser-playwright` to the catalog and to the three Cores only;
- a per-Core `browser` project (inline, not a shared config) with
  `provider: playwright`, `headless: true`, `instances: [{ browser: 'chromium' }]`,
  `fileParallelism: true`, bounded to one Chromium per unit;
- `playwright install chromium` in CI + `Containerfile`, one job with a
  bounded matrix over the three Cores.

## Cloudflare / virtual-module mock audit

All four mock modules are byte-identical across the units that use them.

| Mock                                                     | Units             | Class                                                                                                                                                                                         | Decision                                                                                            |
| -------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `cloudflare:workers` (`env` proxy + `setEnv`/`resetEnv`) | 3 Cores, 12 Astro | **B** — intentional dependency-seam double: tests inject arbitrary binding shapes (VPC service, `REVISION`, `RATE_LIMITER`, none) that no Node environment supplies                           | keep                                                                                                |
| `cloudflare:workers` — `setEnvShouldThrow` branch        | same              | **C** — simulates `env` being unavailable, a condition the mock's own comment notes cannot occur outside a request context; this is a workerd contract currently only asserted against a fake | keep for now; convert to a real missing-binding / real `env` assertion when the workerd layer lands |
| `astro:env/client` (`PUBLIC_REGION`)                     | 12 Astro          | **B** — Astro virtual module, resolvable only through the Astro/Vite pipeline; build-time constant                                                                                            | keep                                                                                                |
| `astro:middleware` (`defineMiddleware` identity)         | 12 Astro          | **B** — Astro virtual module; identity passthrough is the real behaviour (type helper)                                                                                                        | keep                                                                                                |
| `@tanstack/react-start/server-only` (empty)              | 3 Cores           | **B** — side-effect marker whose only job is to fail the client bundle; empty is correct for Node                                                                                             | keep                                                                                                |

No mock is class **A** (obsolete because workerd now supplies the behaviour),
because the Vitest layer has no workerd runtime yet. Nothing was removed.

## Coverage

- Provider stays `@vitest/coverage-v8` on Vitest 5. The Istanbul switch is
  bundled with the deferred workerd migration (Istanbul is only _required_ where
  a suite runs through `@cloudflare/vitest-plugin`, which cannot produce native
  V8 coverage). Running Istanbul now would re-instrument twenty green suites and
  re-tune twenty threshold sets for no correctness gain.
- Thresholds remain 100/100/100/100 and gained **`perFile: true`** in all twenty
  units: a small uncovered file can no longer hide behind a large covered one.
  This was a safe tightening — global 100% already implies every file at 100% —
  made explicit and future-proof.
- Coverage exclusions were audited. Every current exclusion is class 1
  (generated / non-source: `routeTree.gen.ts`, `+types/**`, `*.d.ts`, `*.astro`,
  `astro.config.mjs`) or class 2 (framework glue with no executable contract a
  Node test can reach: `src/lib/app-handler.ts` builds the TanStack request
  handler that exists only in the Worker build; `src/security-nonce-als.ts` is a
  Worker-only `node:async_hooks` install; `src/index.tsx` / `page-content.tsx` /
  `renderer.tsx` / `shell.tsx` are browser-rendered entries). None is class 3
  (excluded only because the old environment could not execute it) or class 4
  (ordinary application code) — the code behind the class-2 exclusions becomes
  testable only in the deferred workerd / browser layers, and the exclusions
  should be revisited then. Each exclusion keeps its explaining comment beside
  it.

## Fail-closed execution contract (all twenty units)

Added inline to every `vitest.config.ts` `test` block, identical across units:

```
allowOnly: false
passWithNoTests: false
retry: 0
isolate: true
fileParallelism: true
minWorkers: 1
maxWorkers: 2
maxConcurrency: 4
mockReset: true
restoreMocks: true
unstubEnvs: true
unstubGlobals: true
dangerouslyIgnoreUnhandledErrors: false
testTimeout: 10_000
hookTimeout: 10_000
teardownTimeout: 10_000
slowTestThreshold: 300
sequence: { concurrent: false, shuffle: false }
```

`retry: 0` — a flaky test is a defect, not something to paper over.
`expect.requireAssertions` was **not** enabled: a meaningful minority of the
~3600 existing tests are "renders without throwing" / "resolves" checks that use
no top-level `expect`, and forcing the flag would be churn without a
correctness gain. It is the one strict setting deliberately left off.

All twenty suites and the root invariant suite pass unchanged with these
settings — no test relied on a leaked mock, stub, env var or global.

## Stress / order-dependency mode

New `test:stress` script per unit and at the root:

- per unit: `vitest run --sequence.shuffle --no-cache`
- root: fans out `test:stress` over the units (bounded
  `--workspace-concurrency=4`) then runs the invariant suite with
  `--sequence.shuffle`.

Not part of the fast `pnpm run test` loop. Shuffles both file order and
within-file test order; run three times back-to-back during this work (see
Verification) — no order-dependence, module-state leak, global leak or race
surfaced. No shared-state defect was found.

**`--sequence.concurrent` was tried in the stress script and removed.** Forcing
every test in a file to run concurrently made ~10 files fail (in `rails-client`,
`middleware`, `rails-entries`, `health-route`, …). Inspection confirmed these
are not defects: the tests legitimately share module state — the
`cloudflare:workers` `env` mock, `vi.stubEnv`, and `vi.fn()` spies reset in
`beforeEach` — and are correctly authored as sequential. This matches the task's
own "poor candidates for `test.concurrent`" list. The stress mode therefore
shuffles order only; `test.concurrent` remains an opt-in per independent test,
of which there are currently none in production suites.

## Parallelism topology

Five concurrency layers, bounded so the product does not explode:

1. **pnpm workspace fan-out** — pinned explicit `--workspace-concurrency=4` on
   the root `test` and `test:stress` scripts (was the implicit default 4).
2. **Per-unit Vitest file workers** — `minWorkers: 1`, `maxWorkers: 2`,
   `fileParallelism: true`, `isolate: true`.
3. **Same-file concurrency** — `maxConcurrency: 4`, but `sequence.concurrent:
false` by default; only the stress loop turns it on. No production test file
   is globally concurrent.
4. **workerd process concurrency** — N/A (layer deferred).
5. **Browser Mode file concurrency** — N/A (layer deferred).

Effective worker ceiling for the normal run: `4 units x 2 workers = 8`
concurrent Vitest workers plus fan-out overhead — well within the CI runner and
far below the 32-core dev host, which is the point (bounded CPU/memory, not
maximum throughput at every layer).

### Benchmark

Host: 32 vCPU, 125 GiB RAM. Command timed: `pnpm -r --workspace-concurrency=<wc>
run test` (twenty units; excludes root invariant suite). Two runs each, warm.

| Config                                                             | wall (s)        | CPU%  | peak RSS (KiB) | result |
| ------------------------------------------------------------------ | --------------- | ----- | -------------- | ------ |
| baseline `pnpm run test` (all units + invariants, implicit wc)     | 12.3            | 1735  | ~279k          | pass   |
| wc=1, default workers                                              | 21.9 / 22.1     | ~820  | ~280k          | pass   |
| wc=2, default workers                                              | 14.8 / 14.7     | ~1350 | ~275k          | pass   |
| **wc=4, default workers**                                          | **10.9 / 11.0** | ~1940 | ~270k          | pass   |
| wc=6, default workers                                              | 10.9 / 10.8     | ~1970 | ~270k          | pass   |
| wc=8, default workers                                              | 10.3 / 9.9      | ~2150 | ~265k          | pass   |
| wc=4, `maxWorkers: 2` (chosen)                                     | 20.8            | ~706  | ~282k          | pass   |
| full `pnpm run test`, wc=4, `maxWorkers: 2` (chosen, + invariants) | 21.9            | ~667  | ~282k          | pass   |

Reading:

- Workspace concurrency: the knee is **wc=4**. wc=1→4 nearly halves wall time
  three times over; wc=4→8 buys ~1 s for +200 % CPU. wc=4 is also the pnpm
  default, so no per-developer surprise.
- `maxWorkers: 2` roughly doubles wall time (21 s vs 11 s) while cutting CPU to
  ~1/3 (≈667 % ≈ 6–7 cores, vs ≈1940 %). This is the deliberate trade the task
  asks for: bounded CPU/memory, not the fastest warm run. On a 2-vCPU
  `ubuntu-slim` CI runner the unbounded default would oversubscribe
  (4 units x ~1 worker is already the runner's limit); the explicit bound makes
  the ceiling `wc x maxWorkers` predictable regardless of host size.
- Stability: every configuration passed both runs and the three stress runs.

**Chosen:** workspace concurrency **4**, per-unit `maxWorkers` **2**
(`minWorkers` 1).

## Parameter matrices

Not expanded in this pass. The existing suites already carry substantial
table-driven coverage (locale matrices in `route-announcer`, per-page `<h1>`
matrices in `pages-smoke`, the fifteen-probe Rails health matrix in the root
invariants, surface matrices in `deployment-unit-boundaries`). Adding
`*.concurrent.each` matrices is only sound once `sequence.concurrent` isolation
is proven per file, which pairs naturally with the deferred workerd/browser
work. Flagged as follow-up; no meaningless combinations were added for count.

## Verification

All from repo root unless noted, 2026-09-07:

- `pnpm run format` — pass (67 + 1562 files, no rewrites from these changes)
- `pnpm run test` — pass: twenty units green, root invariant suite 567 passed /
  1 skipped. WALL 21.9 s, CPU ~667 %.
- `pnpm run test:stress` x3 back-to-back — pass every run, no order-dependence
- concurrency benchmark — table above
- No Vitest suite starts a dev/application server: configs add no
  `globalSetup`, no `webServer`, no `dev`/`preview`/`wrangler dev` invocation;
  `test:stress` is `vitest run` only.
- Per-unit independence: `pnpm --dir <unit> run test` runs standalone for each
  unit (the fan-out is just the per-unit script); no root Vitest config exists.
- `test/deployment-unit-boundaries.test.ts`, `test/package-manager-invariants.test.ts`,
  `test/evidence-layout.test.ts` — pass (part of `pnpm run test`)

### Not verified

- `pnpm run check:static` (format:check / lint / lint:types / knip / typecheck /
  check:deps / check:architecture / check:spelling) — expected clean (only
  `vitest.config.ts` `test`-block keys and two `package.json` script lines
  changed) but not run in this session.
- `pnpm run build` / `check:size` — untouched; no browser bundle changed.
- CI on a real `ubuntu-slim` runner.

## Remaining limitations

1. **workerd runtime layer** — deferred until `@cloudflare/vitest-plugin` ships
   a `vitest@^5` peer. Category-C mock behaviour (`setEnvShouldThrow`) still
   runs against a fake.
2. **Vitest Browser Mode** — deferred pending an explicit decision to put
   Chromium in CI / the `Containerfile`, consistent with the existing
   Playwright-E2E policy.
3. **Istanbul coverage** — deferred with (1); V8 remains correct for the
   Vitest-5 Node layer.
4. **`expect.requireAssertions`** — intentionally off (see above).
5. **Concurrent parameter matrices** — follow-up, paired with (1)/(2).
