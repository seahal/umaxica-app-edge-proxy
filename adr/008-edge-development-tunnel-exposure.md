# ADR 008: Edge development surfaces are published through the Rails-owned Tunnel

## Status: Superseded by ADR 014

ADR 014 replaces the Rails-owned shared connector and Podman network with an Edge-owned Tunnel.
The dated verification evidence below remains historical evidence for the previous topology.

## Amends

- **ADR 006 §6** — "No connector, **and no shared Podman network**, in this repository." The
  connector half stands. The shared-network half is retracted: this repository not only shares a
  network, it defines the one the connector joins.
- **ADR 006 §Guardrails / `test/compose-tunnel-invariants.test.ts`** — "a `compose.custom.yaml` …
  in this repository" was itself forbidden, as a filename proxy for "the Rails connector overlay was
  not copied here". Retracted: this repository now has its own `compose.custom.yaml`, named to match
  the other end of the shared connector, and the guarantee moved from the filename to the contents.
- **ADR 003 (2026-08-10 Addendum)** — "Apex domain binding is declared in `wrangler.jsonc` as a
  top-level `routes` entry with `custom_domain: true`; that is the single source of truth. Do not
  add, move, or remove apex domains in the Cloudflare dashboard." Retracted for as long as the
  development Tunnel owns the apex hostnames.

## Context

The sixteen non-core Edge development surfaces — four Hono apex workers and twelve Next.js content
frames — were reachable on `localhost` only. `compose.yaml` publishes their ports to host
`127.0.0.1`, so nothing outside the machine could load a surface under development.

Rails already runs the system's one Cloudflare Tunnel connector (`umaxica-apps-global`, service
`cloudflare-tunnel`, token-based, `tunnel --protocol quic run`, network `frontend`). ADR 006 §6
forbade this repository from running a connector, for a measured reason: two connectors on one
tunnel make Cloudflare load-balance across both, so Rails-bound requests would land on an Edge
container roughly half the time. It went further and forbade a shared Podman network as well.

That second prohibition is what blocked the work, and it turned out to be broader than its own
rationale. The load-balancing failure comes from _registering a connector_, not from _being
reachable by one_. Nothing about joining a network causes it.

Sharing the single connector is additionally a requirement of the Core end state:
`jp.umaxica.{app,com,org}` is one FQDN where Rails owns some paths and Next.js the rest, and path
routing can only resolve that on one connector. A separate Edge tunnel would foreclose it.

## Decision

**Edge defines the Podman network the connector joins; it still owns no connector and no token.**

`compose.custom.yaml` declares a compose-managed network named `umaxica-edge-tunnel` and attaches
the `core` service to it under the alias `edge-core`. The Rails side references that name with
`external: true`. Cloudflare Public Hostname entries point at `http://edge-core:<port>`.

### Why Edge owns the network rather than joining one

The first shape had it the other way: an `external: true` network the operator named through
`EDGE_TUNNEL_NETWORK`, on the principle that this repository should not create the connector's
topology. That principle held, but the mechanism made the network unusable from the primary
development environment. An external network must exist before `up`, so a machine that had never run
the connector could not start the devcontainer at all — which is why `devcontainer.json` had to
exclude the overlay, leaving Tunnel exposure available only through `scripts/dev-start`. That is not
a viable split when the devcontainer is where development actually happens.

Inverting ownership removes the constraint without weakening anything that mattered. The rule worth
keeping is that Edge registers no connector and holds no token — a second connector on one tunnel
makes Cloudflare load-balance across both. Defining a network is not registering a connector, and
both halves of the real rule still hold, enforced unchanged.

It also removes a failure mode the environment variable carried: a misspelled network name would
silently create an empty network and isolate the container on it, presenting as a Cloudflare-side
502 rather than as a typo. A literal name has nothing to misspell.

An always-present network is not exposure. Reaching a dev server from the internet additionally
requires the connector to join the network **and** a Cloudflare Public Hostname pointing at it, both
deliberate operator acts. `scripts/dev-start --tunnel` therefore remains as the flag for the
non-devcontainer path, but no longer demands any prior setup.

Cost: the Rails repository gains a three-line external network reference on its
`cloudflare-tunnel` service. That is the mirror image of what Edge previously carried.

Three properties of this shape are load-bearing:

**The alias is `edge-core`, not `core`.** Podman registers the compose service name as a
network-scoped DNS name — verifiable from inside the container with `getent hosts core` — and the
Rails project also has a service called `core`. Two containers answering to `core` on one network
would make the connector's own Rails origin ambiguous, which is the same class of intermittent
misrouting ADR 006 §6 was protecting against. Every ingress entry must use the explicit alias, and
`test/compose-tunnel-invariants.test.ts` asserts the alias is present and that the overlay declares
no service other than `core`.

**Host-published ports cannot be used.** `compose.yaml` publishes to `127.0.0.1` only. A
containerised connector cannot reach that, not even through `host.docker.internal`: a host-gateway
connection does not arrive on the loopback interface the publish is bound to. Widening the publish
to `0.0.0.0` would have reversed the container-security hardening in the same working tree, so
sharing a network and addressing the container directly is the only option that costs nothing
elsewhere.

**The devcontainer reads the overlay.** It is the primary development environment, so anything only
reachable through `scripts/dev-start` is effectively unreachable. The two entry paths now land on the
same network: `devcontainer.json` lists `../compose.custom.yaml`, and `scripts/dev-start --tunnel`
passes the same file.

**`{app,com,org,net}/apex/wrangler.jsonc` now declares `"routes": []` at the top level.** The
previous `{ pattern: "umaxica.<brand>", custom_domain: true }` existed so that `wrangler deploy`
would reconcile the apex binding on every production deploy and stop a hand-edited dashboard entry
from redirecting the hostname. Once the Tunnel owns those hostnames, that same property is the
hazard: a custom domain and a Tunnel Public Hostname cannot both own one name, so any production
deploy would silently reclaim the hostname and break the development route. Empty is therefore
deliberate, and restoring an apex domain means removing the Public Hostname entry first, then
putting the `routes` entry back — in that order.

### Hostnames

The published set is the sixteen hostnames in
`docs/operations/cloudflare-tunnel-development.md`'s route table. The naming rule —
`umaxica.<brand>` for apex, `info.umaxica.<brand>` for the global info surface, and a **single
hyphenated label** `<frame>-jp.umaxica.<brand>` for the regional docs/news/help surfaces — is
current and intentional: nesting the region as its own label would add a certificate level, and
development and staging avoid that cost. It is encoded once, in `tunnelHostFor()`, so the checker
cannot drift from it.

Core keeps `jp.umaxica.{app,com,org}` and is not published here.

### Eight production surfaces are replaced, with authorization

Measured on 2026-08-10, eight of the sixteen hostnames were live production surfaces: the four
apexes on their apex Workers, and `docs-jp.umaxica.com`, `news-jp.umaxica.com`,
`news-jp.umaxica.org`, `help-jp.umaxica.org` on deployed OpenNext Workers. Handing them to the
development Tunnel takes those production surfaces offline and replaces them with a developer's
machine.

This was raised explicitly and authorized explicitly as a required cutover; the hostname plan was
confirmed unchanged. It is recorded here because the consequence is not reversible by accident:
while the machine, the container, or a given dev server is down, those hostnames return 502.

## What this record explicitly did NOT change

- **The no-connector rule.** No `cloudflared` service and no `TUNNEL_TOKEN`/`CLOUDFLARED_TOKEN` in
  this repository. Only the filename-based half of that rule was retracted (see "Amends");
  `test/compose-tunnel-invariants.test.ts` now enforces the substance across `compose.custom.yaml`
  too, and additionally asserts the file list itself is complete so a renamed overlay cannot slip
  outside the checks.
- **Core.** `{app,com,org}/core`, `core-dispatch.ts`, `worker.ts`, and `jp.umaxica.*` are untouched.
  The three cores' `next.config.ts` — including their existing `allowedDevOrigins` — are untouched.
- **Rails ingress.** `core-jp.*` and `side-jp.*` are unchanged and were confirmed still
  302-to-Access before and after the Edge changes.
- **The Workers VPC transport.** `UMAXICA_APPS_EDGE_CF_WORKERS_VPC`, its `service_id`, and its
  `env.vpc`-only placement are as ADR 005/006 left them. A Tunnel route is not a Workers binding.
- **`env.development` / `env.test` `"routes": []`.** Those pins exist for their own reason (named
  environments inherit `routes`) and are unrelated to this change.
- **`dev/apex` / `dev/acme`.** Out of scope; `umaxica.dev` is delegated to Vercel DNS, not
  Cloudflare.

## Guardrails

- `test/compose-tunnel-invariants.test.ts` — `compose.custom.yaml` joins the enumerated compose set
  for the no-connector and no-token assertions, and gains its own: the overlay declares exactly one
  service (`core`), publishes the `edge-core` alias, and declares its network under the literal name
  `umaxica-edge-tunnel` rather than as `external: true` or through an environment variable — so the
  devcontainer can read the overlay and there is no network name to misspell. It also asserts the
  devcontainer **does** list the overlay, since the whole point of the inversion was to make that
  possible.
- `tools/verify-edge-connectivity.mjs` modes `tunnel` and `tunnel:apex` — seven gates per surface
  (DNS, Cloudflare, Access, origin, identity, route, no-leak), with `core` excluded by construction.
  Origin-down statuses report BLOCKED, not FAIL, because a stopped dev server is an ordinary state.
  `tunnel:apex` narrows to the four Hono apexes, the only surfaces whose brand the response proves.
  Access-protected surfaces with no service token in the environment report BLOCKED rather than PASS.
  Excluded from `all`, which depends on no external configuration.
- `scripts/check-apex-domains` — still the check for apex brand mix-up, but note its meaning moved:
  it now tests whatever currently owns the hostname, which is the Tunnel rather than the Worker.

## Outcome

**Implemented on the Edge side.** `compose.custom.yaml`, the `--tunnel` flag on
`scripts/dev-start`/`dev-stop`, `allowedDevOrigins` on the twelve non-core frames, empty apex
`routes`, the extended invariant test, and the `tunnel` verification mode are in place, and
`format:check`, `lint:check`, `typecheck`, and the test suite pass.

The pre-cutover baseline is recorded in
`docs/operations/cloudflare-tunnel-development.md`. **End-to-end verification is not yet done**: the
Cloudflare Public Hostname entries, the custom-domain removals, and the cache-bypass rules are the
operator's step and were still pending when this record was written. Eight hostnames were confirmed
occupied by production Workers and eight had no DNS record at all.
_(Superseded 2026-08-11 — verification is complete; see the closeout amendment.)_

Two defects surfaced during the baseline and are **not** fixed by this work: `umaxica.net` is bound
to the `app/apex` Worker in production (the ADR 003 incident, still live, `scripts/check-apex-domains`
fails on it), and the deployed content Workers are stale enough to answer 404 on `/rails-health`.
Both need separate attention.

### Amendment, 2026-08-10 — local origins re-verified; the eight replaced hostnames are dark

Re-measured before handing the route table to the operator, because the first run's dev servers
were no longer up and evidence that does not share a timestamp with the cutover is not evidence for
it. **All sixteen surfaces PASS on both addresses** — `127.0.0.1:<port>` and the container address
`10.89.4.2:<port>` — with the production `Host` each will receive. Three things this run
established beyond the first:

- **`edge-core` was exercised by name.** `getent hosts edge-core` → `10.89.4.2`, and
  `curl http://edge-core:5401/health.json` answered `service=app`, `environment=development`. The
  literal string the ingress entries carry is now measured, not inferred from the compose file.
- **JS and CSS were checked separately.** The first `/_next/static/` reference in these pages is a
  stylesheet, so probing "the first asset" never touches a script. Both answered 200 on all twelve
  frames, on both addresses.
- **Host validation is absent on the frames too**, not only the apexes. `Host: nonsense.invalid`
  returns a working page on 5306. The catch-all is a required part of the ingress, not a hardening
  extra.

The Cloudflare side had moved since the baseline, in two ways that matter:

- **The eight replaced production hostnames now have no A record at all.** Their custom domains and
  Worker routes were removed, but no Public Hostname replaced them. The record above says the
  cutover takes those surfaces offline "while the machine is down"; in fact they are currently
  unresolvable, which is a wider window than that sentence describes. Nothing was reverted — the
  cutover is authorized — but the state is recorded rather than left implied.
  _(Resolved 2026-08-11 — all eight resolve and answer through the Tunnel; see the closeout
  amendment.)_
- **Core moved.** `jp.umaxica.{app,com,org}` now resolve and 302 to Access; `core-jp.umaxica.app`
  no longer resolves. This is the operator's Core work and is untouched here. One consequence for
  Edge: the `{app,com,org}/apex` `/` redirect target now resolves, where the route table said it
  did not. The apex behaviour is unchanged; only the target's existence is.

Two decisions were taken and are recorded in
`docs/operations/cloudflare-tunnel-development.md`: the four apex Access applications carry a
**Bypass policy for `/health*`**, so `service` stays machine-checkable and a brand mix-up remains
detectable without a browser; and **no Access service token is used**, so the authenticated half is
the operator's browser evidence and the checker's post-Access gates report BLOCKED rather than PASS.
_(The Bypass decision was **reversed** on 2026-08-11 — no Bypass exists on any surface. The
service-token decision stands. See the closeout amendment.)_

**Still pending, unchanged:** the sixteen Public Hostname entries, the catch-all 404, the
cache-bypass rule, and the Access applications. No Edge code changed in this amendment.
_(Superseded 2026-08-11 — Public Hostnames and Access are 16/16; the catch-all and the cache-bypass
rule were examined and declined. See the closeout amendment.)_

### Amendment, 2026-08-11 — the three `info` frames get a `/health.json`, closing brand mix-up for them

**Amends this record's own "Known limitations"** as carried in
`docs/operations/cloudflare-tunnel-development.md`: "brand correctness rests on the ingress table
alone, and is recorded as UNVERIFIABLE rather than PASS. Closing this would mean adding a per-frame
identity endpoint, deliberately not done here." That is now done for `info` and stands unchanged
for `docs`, `news`, and `help`.

The reason for the reversal is that "not done" turned out to cost more than it saved. Preflight for
the three `info` hostnames measured the frames as indistinguishable in **every** response — markup,
response headers, and `/rails-health` body are the same bytes in all three copies, and
`PRIVATE_RAILS_ORIGIN`, the only per-brand value in the source, never reaches a response. A
transposed Public Hostname entry would therefore have produced a completely clean verification run.
The original judgement treated the gap as a reporting nuance ("record it as UNVERIFIABLE"); it is
actually the difference between a negative test that can fail and one that cannot.

`{app,com,org}/info/src/app/health.json/route.ts` answers
`{"status":"OK","service":"<brand>","frame":"info","environment":…,"time":…}`. Three properties are
load-bearing:

- **`service` is a build-time literal, not a header read.** The handler takes no `Request` and does
  not import `next/headers`. Deriving the brand from the incoming `Host` would echo the caller back
  to itself and prove nothing about which application received the request — a transposed ingress
  entry would still look correct. `test/tunnel-surface-identity.test.ts` asserts this structurally.
- **The path matches the apexes'**, so the Access Bypass rule is the same `/health*` and there is
  one rule shape across every published surface, not two.
- **Each frame owns its own copy**, as `CLAUDE.md` requires. The failure mode that creates — one
  copy edited and two left behind, or all three set to the same brand, which would make the mix-up
  check silently vacuous — is what the new test exists to catch.

`tools/verify-edge-connectivity.mjs`'s `ident` gate now requires `service`/`frame` to match where
the route exists, and reports **WARN** where it does not, so "the brand was not checked" and "the
brand is correct" stop looking the same in the matrix. Nine frames are WARN today by construction.

Adding the route to `docs`, `news`, and `help` is the obvious follow-on and is deliberately not
bundled here: today's scope was `info`. `IDENTIFIED_FRAMES` in the test is the list to extend, and
it must be extended _with_ each route rather than ahead of it.

Core, the Workers VPC transport, the apexes, and the Rails surfaces are untouched by this
amendment.

One item for the Core work, found while verifying and deliberately not fixed here:
`{app,com,org}/core/next.config.ts` declare `allowedDevOrigins: ['localhost', '*.localhost',
'172.18.0.2']` — a hard-coded container address and **no FQDN**. The twelve content frames each
list their own tunnel hostname, which is what stops Next 403-ing `/_next/*` and the HMR socket. If
`jp.umaxica.*` is ever served by `next dev` through the Tunnel, the cores will need the same
treatment.

## Amendment, 2026-08-11 — closeout: sixteen published, sixteen behind Access

The operator completed the Cloudflare configuration over the course of 2026-08-11 and each step was
measured from outside. Raw values, per-hostname results and the seven-gate matrices are in
`docs/operations/cloudflare-tunnel-development.md`; this amendment records what it means for the
statements above.

### What this reverses in the record

- **"Cloudflare configuration pending" (Status line).** Replaced. Steps 1–4 and 6 of the operator
  procedure are done and verified.
- **"End-to-end verification is not yet done" (Outcome).** Done. All sixteen hostnames were reached
  through the Tunnel and each was confirmed to be the _intended_ application, not merely a 200.
- **"The eight replaced production hostnames now have no A record at all."** Resolved. All eight
  resolve and answer through the Tunnel; they return a Cloudflare 502 while the development machine
  or the relevant dev server is down, which is the narrower window the original record described.
- **"Still pending: the sixteen Public Hostname entries, the catch-all 404, the cache-bypass rule,
  and the Access applications."** Public Hostnames and Access applications are done, 16/16. The
  catch-all and the cache rule were judged unnecessary — see below.
- **"The four apex Access applications carry a Bypass policy for `/health*`."** **Reversed.** No
  Bypass exists on any surface; Access covers the whole host, health endpoints included.

### The `/health*` Bypass, reversed

The 2026-08-10 decision was that `service` must stay machine-readable so a brand mix-up remains
detectable without a browser. That reasoning was sound, but the bypass was never the only way to
satisfy it: a service token — which `tools/verify-edge-connectivity.mjs` already accepts and prompts
for — restores machine verification without an unauthenticated path. The bypass was a consequence of
the separate decision not to use a service token, not an independent requirement.

Measured cost of the reversal, accepted deliberately:

- `scripts/check-apex-domains` reports `FAIL … served by <unreachable>/apex` on all four apexes. It
  is a manual diagnostic, not wired into CI, lefthook, or any `package.json` script, so nothing
  automated regressed.
- The checker's gates from `orig` onward are **BLOCKED** on all sixteen — unproven, deliberately not
  PASS. `dns`, `cf` and `acs` remain ok, so the suite still passes.
- Every surface now answers an identical 302 regardless of which application, which port, or whether
  anything is listening. The identity evidence in the record was all gathered before Access was
  applied and cannot be reproduced without a browser or a service token.

If machine verification of brand is wanted later, add service-token support to
`scripts/check-apex-domains` rather than reintroducing the bypass; `scripts/check-tunnel` already
carries the safe pattern (`curl --config -`, headers over stdin so they never reach argv). If a
bypass is reintroduced anyway, scope it to `/health.json` alone — `/health` and `/health.html` are
human-facing HTML and no checker needs them.

### The catch-all 404, judged unnecessary

The operating document called the catch-all "a required part of the ingress configuration, not a
hardening extra", on the grounds that the applications perform no `Host` validation — `Host:
nonsense.invalid` still returns a working 200 on every port. That measurement stands. The conclusion
does not, because it was drawn when no surface had Access:

1. **There is no path by which an unknown `Host` reaches the connector.** A request must arrive via
   Cloudflare for a hostname whose DNS points at the tunnel. In this zone those records are created
   one at a time, deliberately, alongside the ingress entry.
2. **`cloudflared` cannot run without a catch-all.** It is required as the last ingress rule, and a
   dashboard-managed tunnel supplies one. It is not a thing to add; it is a thing to confirm exists.
3. **Access, not the catch-all, is what stands between the internet and the origins**, and it now
   covers all sixteen.

### The Cache Rule, deliberately not applied

The concern was that `docs-jp.umaxica.com` served `cache-control: s-maxage=31536000`, so stale
production HTML could keep being served from the edge. That header is what the **origin** sent; it
is not evidence that Cloudflare cached anything, and Cloudflare does not cache HTML by default. The
Access 302 itself was measured returning `cache-control: private, max-age=0, no-store`.

Whether an authenticated response is served from cache cannot be determined without authenticating —
`cf-cache-status` is not readable unauthenticated. Rather than configure against a hypothesis, this
is left until stale HTML is actually observed.

### The general rule this work produced

The ordering is the transferable part, and it is not merely a convenience:

1. **Per surface: Tunnel → verify identity → Access.** Access makes every surface answer an
   identical 302, so it removes the ability to tell which application, which port, or whether
   anything is listening. The window between the two is the only one in which the ingress can be
   checked without a credential.
2. **Across surfaces: start with the ones whose identity is verifiable from the response.** A 200
   cannot catch a transposed entry when several brands return byte-identical HTML.
3. **That window is an exposure cost.** "Tunnel first" means deliberately creating unauthenticated
   time. Provisioning a service token up front removes the need for it.

Both 2 and 3 were violated in practice and are recorded as such. The content frames were published
before the apexes, so the surfaces exposed first were exactly the ones whose brand cannot be read
from a response — their mapping had to be established afterwards by ablation (stopping one brand's
dev servers and observing which hostnames returned 502). And `info.umaxica.{app,com,org}` served
live development content unauthenticated from 06:51 to roughly 08:1x UTC, about ninety minutes.
Neither caused harm; both were avoidable.

### Unchanged by this closeout

The `umaxica.net` production misbinding (ADR 003) is still live. The Tunnel masks the symptom —
`umaxica.net` answered `service=net` correctly while unauthenticated — and the dashboard binding
will reassert itself the moment the hostname returns to its Worker. The stale deployed content
Workers answering 404 on `/rails-health` are likewise untouched. Core, the Workers VPC transport,
and the Rails surfaces are untouched.

---

## Amendment (2026-09-01): the compose overlay is retired

This ADR is a historical record and its body is left as written. The file it
names throughout, `compose.custom.yaml`, no longer exists.

The overlay was mandatory in practice — it carried the SELinux `label=disable`
without which `/home/edge/workspace` is unreadable on an Enforcing host — while
being gitignored and seeded by `scripts/dev-start`. `.devcontainer/devcontainer.json`
therefore named a file that a fresh clone does not contain, and every path that
does not run `scripts/dev-start` (Codespaces, `devcontainer up`, Remote-SSH plus
"Reopen in Container") failed at Compose resolution with
`open .../compose.custom.yaml: no such file or directory`.

The contract is now:

| File                            | Role                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `compose.yaml`                  | the complete standard environment; a fresh clone starts from it alone |
| `compose.override.yaml`         | optional, gitignored, host-specific; never created automatically      |
| `compose.override.yaml.example` | tracked documentation of the above                                    |

What moved into `compose.yaml`: `security_opt: label=disable` on `core` (SELinux
Enforcing is a supported host, so supporting it is standard configuration, and
the option is inert on hosts without SELinux under both Docker and Podman) and
`GH_TOKEN: ${GH_TOKEN:-}` (host-portable, no literal, `:-` so a token-less
machine still resolves). What stayed optional: the `~/.ssh/known_hosts` bind and
the ssh-agent socket, both of which name host paths that may not exist and whose
absence fails the bind before any container starts.

`.devcontainer/devcontainer.json` now lists `../compose.yaml` alone. The Dev
Containers CLI passes each entry to Compose as `-f`, which also suppresses
Compose's auto-discovery of `compose.override.yaml`, so the optional override
applies to `scripts/dev-start` and a bare `docker compose` and not to the editor.

The tunnel decisions this ADR records are unaffected: the connector, its pinned
release and its hardening already live in `compose.yaml`, and only its token
comes from the gitignored `.env`.

---

## Amendment (2026-09-02): content frames do not carry `/health.json`

The 2026-08-11 amendment put `/health.json` on `{app,com,org}/info` so a tunnel
hostname mix-up was visible in the response. That made `info` the only content
surface with a second health document. The twelve Astro frames now share one
liveness contract: `/health` (Edge + Rails). `/health.json` stays on the apex
workers, where `service` is part of `createApexApp`.

Brand mix-up on a content frame is again unproven from the HTML (WARN in
`tools/verify-edge-connectivity.mjs`). `test/tunnel-surface-identity.test.ts`
asserts that none of the twelve frames reintroduce `health.json.ts`.
