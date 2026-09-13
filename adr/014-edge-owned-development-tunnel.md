# ADR 014: Edge owns its development Tunnel

## Status: Accepted (amended 2026-09-04 — fallback withdrawn, token variable renamed)

## Context

Edge development surfaces need browser access through Cloudflare Access and Tunnel. Workers VPC is
a separate, one-way path from Edge Workers to Global/Rails. Sharing a host Podman network between
the repositories couples independent trust boundaries, while using the same Tunnel token would
register replicas with different origin reachability.

## Decision

Edge runs its own `cloudflare-tunnel` sidecar with a dedicated Tunnel ID, whose connector token
comes from `CLOUDFLARED_TOKEN` in **this repository's** gitignored root `.env` — one variable, no
fallback chain. The connector reaches `core:<port>` only over Edge's compose default network. Global
shares neither the network nor the Tunnel token. Public Hostnames on the Edge Tunnel remain
protected by Cloudflare Access.

Global independently runs the connector used by Workers VPC to reach Rails. No Global-to-Edge VPC
path exists.

### Amendment 2026-09-04: one token variable, no fallback

The original decision allowed `EDGE_CLOUDFLARED_TOKEN` to fall back to a generic
`CLOUDFLARED_TOKEN` "when a machine runs only one tunnel locally". That contradicted this ADR's own
Context, which already recorded that "using the same Tunnel token would register replicas with
different origin reachability" — and that is exactly what happened.

`CLOUDFLARED_TOKEN` is the name the Global/Rails repository uses for _its_ tunnel, and both
repositories read a gitignored repo-root `.env`. On a machine that had the Global value and never
set the Edge one, `${EDGE_CLOUDFLARED_TOKEN:-${CLOUDFLARED_TOKEN:-}}` resolved silently to Global's
token, so Edge's connector joined Global's tunnel as a replica from a network with no route to
Rails. A tunnel token is a "join this tunnel" credential: Cloudflare cannot distinguish such a
replica from a healthy one, requests are routed to the nearest replica rather than load-balanced
across them, and with every replica on one host the result was intermittent failure of both
repositories at once — including the Workers VPC path, which depends on the same Global tunnel.

The fallback is therefore withdrawn. An unset token leaves the Edge tunnel down; it must never take
over another tunnel.

The variable is also renamed from `EDGE_CLOUDFLARED_TOKEN` to plain `CLOUDFLARED_TOKEN`, so each
repository names its tunnel token the same way and no machine needs a second variable. This is safe
because a Compose project interpolates the `.env` beside its own compose file: one name, two files,
two tunnels. The hazard was never the shared name — it was the `:-` chain that let one variable
stand in for another.

What the distinct name did provide, weakly, was a hint that the two values differ. That hint is
replaced by a check that actually holds: `scripts/dev-start --tunnel` decodes the tunnel UUID from
the configured token — the `t` field of the base64 connector token, a dashboard identifier and not
a secret — and refuses to start if a cloudflared container already running on the host serves that
same tunnel. A copied `.env` is now rejected by value rather than trusted by name.

The residual risk that remains is a `CLOUDFLARED_TOKEN` **exported in the shell**, which Compose
prefers over `.env` and which therefore crosses repository boundaries. The UUID check catches that
too whenever the other connector is running, which is the case that matters.

The cloudflared image is pinned to `2026.8.2`; Cloudflare supports releases for one year, so the pin
must be kept current.

## Hostname region label is a per-machine `.env` parameter

The regional surfaces carry a region label in their hostname (`jp` in `docs-jp.umaxica.app`,
`jp.umaxica.app` for Core). **That label is not fixed in the repository** — it is resolved from a
per-machine value in the gitignored root `.env`. This development environment's `.env` sets it to
`jp`; another developer's machine may set it to `us` (or anything else), and their Edge Tunnel
Public Hostnames, Access applications, and `EDGE_TUNNEL_HOSTS` checker override are named to match.

So `docs-jp.umaxica.*` / `jp.umaxica.*` is what _this_ machine publishes; it is not a
repository-wide constant. Anything that hard-codes `jp` (checker rules, docs examples, ingress
lists) is describing one machine's configuration, not the contract.

## Consequences

A new machine must set the Edge-specific token in its gitignored root `.env` before Dev Container
startup. Missing configuration leaves the connector with an empty token, so it exits non-zero and
stays down under `restart: on-failure:3`; `scripts/dev-start --tunnel` refuses outright and names
the variable. It does not fail during Compose resolution — a `:?` guard is not available here,
because Compose interpolates the whole file whichever service is named and the connector shares
`compose.yaml` with `core`. Rotating or revoking one Tunnel does not affect the other repository.
