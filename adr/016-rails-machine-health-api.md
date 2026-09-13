# ADR 016: Edge verifies Rails through the machine-facing Health API

## Status: Implemented — required fields extended, see [Amendment 2026-09-06](#amendment-2026-09-06-timestamp-is-required-namespace-is-additive)

Amends [ADR 009](009-rails-health-entrypoint-and-dispatch-operability.md)
decision 3 (liveness-only `/health/liveness.json`). Does not reopen ADR 009's
merge of `/rails-health` into Edge `/health`, the Host-header dispatch table, or
the public Edge probe representation that later became `text/plain`.

## Context

Rails now publishes two health surfaces with different consumers:

- Operational / Kubernetes probes: `/health`, `/health/startups`,
  `/health/livenesses`, `/health/readinesses` — `text/plain`.
- Machine-facing Health API: `GET /api/v0/health.json` — `application/json`,
  `status` ∈ `{pass, warn, fail}`, with required `checks.startup`,
  `checks.liveness`, `checks.readiness`. `timestamp` was added to the required
  set later; see the amendment below.

ADR 009 recorded Edge probing `/health/liveness.json` only, because that was the
strictest Rails JSON probe at the time and `/health` was polled often enough that
three requests per check were not worth the tunnel traffic. That path is now an
operational artefact, not the multi-runtime contract. Hono, TanStack Start,
Astro, and non-JS runtimes are expected to share `/api/v0/health.json`.

`/api/v0/revision.json` and `/revision` remain deployment identity. A revision
response is not a health pass; a health pass is not a revision match.

## Decision

1. Every Rails-backed frame verifies Rails over Workers VPC with
   `GET /api/v0/health.json` on that frame's existing `PRIVATE_RAILS_ORIGIN`.
   The path has no frame prefix. Workers VPC topology, the Host header, and the
   one-Service-for-fifteen-frames arrangement do not change.

2. The consumer is `src/lib/rails-health.ts` (`checkRailsHealth`), copied
   byte-identically across the fifteen frames. It validates HTTP status,
   `application/json` (parameters such as `charset=utf-8` allowed), JSON parse,
   required fields, and the `pass`/`warn`/`fail` vocabulary. Additive unknown
   fields and extra checks are ignored. Required-field absence, wrong types,
   unknown status values, media-type mismatch, redirects, and HTTP/status pairing
   errors (`200`+`fail`, `503`+`pass`/`warn`) are `invalid-contract`. The
   required-field set is the one in the amendment below, not the one in the
   Context section above it.

3. Transport outcomes stay distinct from service health:
   `not-configured`, `unreachable` (including Workers VPC `ProxyError:`),
   `http-error`, `invalid-contract`, `pass`, `warn`, `fail`. A `503` JSON
   document with `status=fail` means Rails was reached and is unhealthy, not
   that the hop failed.

4. Edge's public `/health` remains the operational `text/plain` contract
   (ADR 009 as later amended by the Kubernetes-style probe work). The Rails
   Health API body is never proxied, logged, or returned. Callers map
   `pass`/`warn`/`not-configured` to Edge readiness `ok`, and `fail` plus every
   transport/contract failure to Edge readiness `error`. Startup and liveness
   stay isolate-only.

5. Apex workers stay Rails-blind. Kubernetes on the Rails cluster may keep
   hitting Rails operational probes; this record is only the Edge → Workers VPC
   → Rails machine path.

## Consequences

- `RAILS_LIVENESS_PATH` and `checkRailsLiveness` are gone from active code.
- `scripts/check-rails` and `tools/vpc-probe/probe.mjs` target the Health API.
- Public Core FQDNs still block `/health/liveness.json` and siblings — those are
  Rails operational JSON, not Edge's Health API consumer.

## Amendment 2026-09-06: `timestamp` is required, `namespace` is additive

Two fields appeared on the Rails document after this record was written. They
are not the same kind of change and are not treated the same way.

### `timestamp` — required, timezone-aware

The required set is now `status`, `timestamp`, and
`checks.{startup,liveness,readiness}`. `timestamp` must match

```text
/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
```

and parse. A local time with no zone is `invalid-contract`: Edge and Rails sit
on opposite ends of a tunnel and share no clock offset, so such a value cannot be
compared with anything and a document carrying one is not answering
the question the field exists to answer. Everything else in decision 2 is
unchanged — this is one more required field, not a new failure mode.

Two implementations enforce it and must agree, which
`test/rails-connection-invariants.test.ts` pins:

| Implementation                      | Transport                  | Consumer         |
| ----------------------------------- | -------------------------- | ---------------- |
| `*/*/src/lib/rails-health.ts` (×15) | Workers VPC, in the Worker | Edge readiness   |
| `scripts/check-rails`               | `podman exec` + `curl`     | a local operator |

**Deployment consequence, in the same spirit as ADR 009 decision 2:** a Rails
build that does not emit `timestamp` makes every frame's Rails probe
`invalid-contract`, which is Edge readiness `error`, which is `/health` 503 on
all fifteen frames. The last Rails document observed from this repository
(`evidence/2026-09-05-workers-vpc-namespace-identity.md`) carried no
`timestamp`. Confirm the field is live before pointing a load balancer or an
uptime check at `/health`.

### `namespace` — additive, and not read by the Worker

Rails reports the namespace it dispatched to as `<frame>/<brand>`
(`evidence/2026-09-05-workers-vpc-namespace-identity.md`). It stays an additive
unknown field as far as decision 2 is concerned: `rails-health.ts` ignores it,
as it ignores every field outside the required set.

The one consumer is `classifyIdentity()` in
`tools/verify-edge-connectivity.mjs`, and that is deliberate. One VPC Service
carries all fifteen frames, so the `Host` header is the only thing selecting a
namespace and a wrong host still answers 200 — a misroute is invisible to every
transport-level gate. Proving identity is a diagnostic the operator runs, not a
per-request check the Worker pays for on the hot path. Making the Worker
enforce it would be a decision, and is not this one.

## Outcome

Implemented in this repository: fifteen `rails-health.ts` copies, Astro and
TanStack `/health` plus `/health/readinesses` routes, repository invariants in
`test/rails-connection-invariants.test.ts`, and local `scripts/check-rails`.

The 2026-09-06 amendment above is implemented too: `timestamp` is enforced by
the fifteen copies, by `scripts/check-rails`, and by the `VPC contract` gate in
`tools/verify-edge-connectivity.mjs`, with the three pinned against each other
in `test/rails-connection-invariants.test.ts`. Recorded in
`evidence/2026-09-06-rails-health-contract-checkers.md`.
