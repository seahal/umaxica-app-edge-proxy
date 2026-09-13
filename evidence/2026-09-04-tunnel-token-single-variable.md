# Tunnel token: one variable, plus a tunnel-UUID collision guard

Follow-up to `2026-09-04-edge-tunnel-token-fallback-removal.md`, which removed the
`${EDGE_CLOUDFLARED_TOKEN:-${CLOUDFLARED_TOKEN:-}}` fallback. This record covers
renaming the surviving variable and replacing the protection the distinct name
had been providing.

## Change

`EDGE_CLOUDFLARED_TOKEN` is renamed to `CLOUDFLARED_TOKEN`, so a machine needs one
tunnel-token variable rather than two. Each Compose project interpolates the `.env`
beside its own compose file, so the name is shared with Global while the values are
not: one name, two files, two tunnels.

The distinct name had weakly signalled "these two values differ". Nothing enforced
it, and it is now replaced by a check on the value. `scripts/dev-start --tunnel`
decodes the tunnel UUID from the configured connector token — the `t` field of the
base64 token, a dashboard identifier rather than a secret — and refuses to start
when a cloudflared container already running on this host serves the same tunnel.

Touched: `compose.yaml`, `scripts/dev-start`, `adr/014-edge-owned-development-tunnel.md`,
`README.md`, `docs/operations/cloudflare-tunnel-development.md`,
`docs/development/devcontainer-cli-podman-startup.md`,
`docs/development/development-environment-overview.md`,
`test/compose-tunnel-invariants.test.ts`, `test/development-container-security.test.ts`.

## Verification

The collision guard was exercised against the real failure, not a synthetic one.
While `.env` still held Global's token and Global's connector was running,
`scripts/dev-start --tunnel` exited 1 with:

    ERROR: tunnel 1d501e9a-62f7-4c0d-ba5e-a26e3f10088f already has a connector on
    this host: umaxicaappsglobaldc_cloudflare-tunnel_1

The operator then replaced `CLOUDFLARED_TOKEN` in `.env` with the Edge tunnel's own
connector token. After `podman rm -f` and `podman compose up -d cloudflare-tunnel`:

| container                                 | tunnel UUID                            |
| ----------------------------------------- | -------------------------------------- |
| `umaxicaappsglobaldc_cloudflare-tunnel_1` | `1d501e9a-62f7-4c0d-ba5e-a26e3f10088f` |
| `umaxica-apps-edge_cloudflare-tunnel_1`   | `dd5500e6-97fe-434e-a389-6399aa866843` |

Distinct, as required. The Edge connector logged four `Registered tunnel connection`
entries (connIndex 0-3, QUIC, nrt05/08/09/16) and stayed up; all connectivity
pre-checks passed.

- `bash -n scripts/dev-start` clean.
- `pnpm vitest run test/compose-tunnel-invariants.test.ts
test/development-container-security.test.ts` — 2 files, 31 tests, 0 failures.
  These suites read `compose.override.yaml.example`, whose deletion in the working
  tree is intentional, so it was restored with `git checkout --` for the run and
  deleted again afterwards.

## Not verified

- No HTTP request was made through either tunnel. Public Hostname routes and Access
  policies on the Edge tunnel were not inspected; a connector registering does not
  mean a hostname resolves to it.
- The full `pnpm test` suite was not run.

## Note for the operator

While confirming what the renamed variable resolved to, `podman compose config`
printed the then-current `TUNNEL_TOKEN` value in full into the assistant session
transcript. That value was Global's connector token (tunnel
`1d501e9a-62f7-4c0d-ba5e-a26e3f10088f`), the one since replaced here. It is still
live on the Global tunnel. Rotating it is the conservative response; `podman compose
config` must not be used to inspect a credential again.
