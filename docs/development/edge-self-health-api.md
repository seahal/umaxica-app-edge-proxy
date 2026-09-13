# Edge self-health API

Machine-facing JSON for **this Edge runtime only**.

```text
GET /api/v0/health.json
```

- JSON, not HTML, not `text/plain`
- framework-independent DTO
- Edge-self-only: no Rails, no Workers VPC, no CMS, no revision
- `Cache-Control: no-store`
- `X-Robots-Tag: noindex, nofollow`
- no language cookie, no CSRF, no authentication, no redirect

Rails publishes a document at the same path (ADR 016), independently. Rails'
document reports Rails. This document reports the Edge Worker that served it.
They are not interchangeable and the shapes are no longer identical — see
[Not the Rails document](#not-the-rails-document).

Operational Kubernetes-style probes remain:

```text
GET /health
GET /health/startups
GET /health/livenesses
GET /health/readinesses
```

Those stay `text/plain`. Do not treat them as this API. Do not treat
`/health.json` (origin root) as this API. Deployment identity is
`GET /revision` and `GET /api/v0/revision.json` — see
[edge-revision-api.md](./edge-revision-api.md).

## Body

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

`status` ∈ `{pass, warn, fail}`. The current isolate has no extra dependency,
so a successful execution returns `pass` throughout.

Those two keys are the whole document. `api/health-api.hurl` asserts the top
level has exactly two members and that `timestamp`, `rails`, `edge`, `revision`
and `version` are all absent.

## Not the Rails document

Rails' Health API (ADR 016) shares this path and this vocabulary, and diverged
from this shape on 2026-09-06:

| Field                                 | Rails `/api/v0/health.json`  | Edge `/api/v0/health.json` |
| ------------------------------------- | ---------------------------- | -------------------------- |
| `status`                              | required                     | always `pass`              |
| `checks.{startup,liveness,readiness}` | required                     | always `pass`              |
| `timestamp`                           | **required**, timezone-aware | **must not be present**    |
| `namespace`                           | additive, `<frame>/<brand>`  | not present                |

Edge has no `timestamp` on purpose. This response is a constant: the handler
touches no binding, no clock and no hop, which is what lets it answer while
every dependency is down. A timestamp would be the only varying byte in it, and
would say nothing the `Date` response header does not already say. `no-store`
already stops it being served stale.

The consequence to hold on to: **`src/lib/rails-health.ts` is not a parser for
this document.** Point it at an Edge unit and it reports `invalid-contract`,
because the required `timestamp` is absent. That is correct — it is a Rails
Health API consumer, and Edge is not Rails.

## Units

| Runtime        | Units                                 | Mechanism                                                  |
| -------------- | ------------------------------------- | ---------------------------------------------------------- |
| Hono           | `{app,com,org,net,dev}/apex`          | `create-apex-app.ts`                                       |
| TanStack Start | `{app,com,org}/core`                  | Server Route `src/routes/api.v0.health[.]json.ts`          |
| Astro          | `{app,com,org}/{docs,help,info,news}` | `src/pages/api/v0/health.json.ts` with `prerender = false` |

No Next.js unit remains active.

HTTP contract: `api/health-api.hurl` in each unit (`pnpm --dir <unit> run test:api`).
