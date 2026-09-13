# Edge tunnel token: `CLOUDFLARED_TOKEN` fallback removed

## Why

On 2026-09-04 the Rails origin in the Global repository became unreachable
through its Cloudflare Tunnel. Three cloudflared containers were running on this
host with an identical `TUNNEL_TOKEN`, so three connectors were registered as
replicas of Global's one tunnel. Only one of them sat on a network with a route
to Rails; a probe container joined to each connector's network reached
`http://www.umaxica.app:3000/` with 302 from Global's `frontend` and with no
response at all from the other two. Cloudflare routes a request to the nearest
replica rather than load-balancing across them, and with every replica on one
host the choice was effectively arbitrary, so both repositories failed
intermittently — including the Workers VPC path, which depends on the same
Global tunnel.

This repository's connector was one of the three. `compose.yaml` read
`${EDGE_CLOUDFLARED_TOKEN:-${CLOUDFLARED_TOKEN:-}}` and this machine's
gitignored root `.env` carries only `CLOUDFLARED_TOKEN`, which is the name the
Global repository uses for its own tunnel. The fallback therefore resolved
silently to Global's token. `adr/014-edge-owned-development-tunnel.md` had
already recorded the hazard in its Context — "using the same Tunnel token would
register replicas with different origin reachability" — while its Decision
permitted the fallback that caused it.

## Change

- `compose.yaml`: `TUNNEL_TOKEN: '${EDGE_CLOUDFLARED_TOKEN:-}'`; the fallback to
  `CLOUDFLARED_TOKEN` is gone. No `:?` guard, for the reason already documented:
  Compose interpolates the whole file whichever service is named, and the
  connector shares the file with `core`.
- `scripts/dev-start`: `--tunnel` now requires `EDGE_CLOUDFLARED_TOKEN` and no
  longer accepts `CLOUDFLARED_TOKEN`; the error names the variable and says why
  reusing Global's token breaks both repositories.
- `adr/014-edge-owned-development-tunnel.md`: amended, fallback withdrawn. The
  Consequences paragraph's claim that missing configuration "fails during Compose
  resolution" was also wrong and now describes the actual behaviour.
- `docs/operations/cloudflare-tunnel-development.md`: documents the single
  accepted variable and adds a token-fingerprint comparison command for
  detecting two connectors on one tunnel.
- `test/compose-tunnel-invariants.test.ts`: asserts the single-variable form and
  that no fallback to `CLOUDFLARED_TOKEN` exists in either variable order.
- `test/development-container-security.test.ts`: expected interpolation updated;
  its line filter now skips comment lines, because the new comments quote the
  withdrawn expression in order to explain it.

## Verification

- `podman compose -f compose.yaml config` resolves with exit 0 and yields
  `TUNNEL_TOKEN: ''` on this machine, whose `.env` still contains
  `CLOUDFLARED_TOKEN`. The takeover path is closed.
- `scripts/dev-start --tunnel` exits 1 with
  `ERROR: --tunnel requires EDGE_CLOUDFLARED_TOKEN in .env.`
- `pnpm vitest run test/compose-tunnel-invariants.test.ts
test/development-container-security.test.ts test/evidence-layout.test.ts`
  — 3 files, 32 tests, 0 failures.

The suites read `compose.override.yaml.example`, which the working tree deletes
(uncommitted, unrelated to this change), so they fail at import until it is
present. It was restored with `git checkout --` for each run and deleted again
afterwards, leaving the working tree as found.

## Not done

- The Edge tunnel remains down. Restoring it needs a second tunnel's connector
  token in `.env` as `EDGE_CLOUDFLARED_TOKEN`; that is an operator action in the
  Cloudflare dashboard and was not performed here.
- The full `pnpm test` suite was not run.
- No end-to-end check through either tunnel was performed.
