# Workers VPC Identity: `namespace` Field Confirmed on `/api/v0/health.json`

Date: 2026-09-05

Repositories:

- `umaxica-apps-edge` at `aad05824` (working tree, uncommitted) — verification only, no code changed
- Rails side (`umaxica-apps-global` or equivalent) — out of scope of this repository; changed by a
  separate request, not observed directly here

## Why

`evidence/2026-09-05-workers-vpc-dedicated-tunnel.md` recorded `VPC identity WARN` for all fifteen
surfaces: `/api/v0/health.json` carried no `namespace` field, so `tools/verify-edge-connectivity.mjs`
could not prove that a Host header (`<frame>.<brand>.localhost`) actually reached its own Rails
namespace rather than some other frame's, or a static/cached response. Every surface returned a
byte-identical body:

```
{"status":"pass","checks":{"startup":{"status":"pass"},"liveness":{"status":"pass"},"readiness":{"status":"pass"}}}
```

ADR 016 (`adr/016-rails-machine-health-api.md`) fixes `status` and `checks.{startup,liveness,readiness}`
as the required contract and says additive unknown fields are ignored, so a `namespace` field is a safe
addition on the Rails side — it changes no existing consumer.

A request was drafted for the Rails-side coding agent (not tracked in this repository) asking for one
additive field: `namespace: "<frame>/<brand>"`, matching the Host-to-dispatch table already encoded in
`classifyIdentity()` (`tools/verify-edge-connectivity.mjs:438`).

## What was verified

`node tools/verify-edge-connectivity.mjs vpc --verbose`, run twice in this session:

- **Before** the Rails-side change: all fifteen surfaces returned the identical body above (no
  `namespace` key) — `VPC identity` WARN ×15.
- **After**: each surface now returns its own `namespace` value, exactly matching
  `<frame>/<brand>` for the Host it was addressed with — `VPC identity` PASS ×15.

Sample bodies from the passing run:

```
core.app.localhost:3000 → {"status":"pass","checks":{...},"namespace":"core/app"}
docs.app.localhost:3000 → {"status":"pass","checks":{...},"namespace":"docs/app"}
core.org.localhost:3000 → {"status":"pass","checks":{...},"namespace":"core/org"}
news.org.localhost:3000 → {"status":"pass","checks":{...},"namespace":"news/org"}
```

All fifteen `<frame>/<brand>` combinations (`{core,docs,help,info,news}` × `{app,com,org}`) were
distinct and correct — no cross-namespace answers observed.

## Result

```
| Surface   | VPC→ | VPC i |
| --------- | ---- | ----- |
| APP/CORE  | ok   | ok    |
| APP/DOCS  | ok   | ok    |
| APP/HELP  | ok   | ok    |
| APP/INFO  | ok   | ok    |
| APP/NEWS  | ok   | ok    |
| COM/CORE  | ok   | ok    |
| COM/DOCS  | ok   | ok    |
| COM/HELP  | ok   | ok    |
| COM/INFO  | ok   | ok    |
| COM/NEWS  | ok   | ok    |
| ORG/CORE  | ok   | ok    |
| ORG/DOCS  | ok   | ok    |
| ORG/HELP  | ok   | ok    |
| ORG/INFO  | ok   | ok    |
| ORG/NEWS  | ok   | ok    |
```

`Direct VPC → Rails` (transport) and `VPC identity` (Host-to-namespace proof) both pass for all fifteen
surfaces, over the dedicated tunnel `umaxica-dev-workers-vpc` (`03a4a67c-2aca-4f2c-9aeb-d1666f18bc87`,
VPC Service `01a06fd0-89b7-7613-9e1d-f7d07c693273`) recorded in
`evidence/2026-09-05-workers-vpc-dedicated-tunnel.md`.

## Not done

- The Rails-side diff that added `namespace` was not inspected from this repository — it lives outside
  this codebase. This record only confirms the observed HTTP behavior from the Edge side.
- No Edge-side code, test, or `tools/verify-edge-connectivity.mjs` logic changed; the check already
  expected this field (see ADR 016 amendment notes and `classifyIdentity()`).
