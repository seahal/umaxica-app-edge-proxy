# Edge development environment overview

The Edge development environment is a rootless Podman workspace. The container is an
independent security principal: it never receives the host HOME, private keys, CLI
credential stores, or Podman/Docker sockets.

It borrows one thing from the host, and only to reach GitHub: `GH_TOKEN` (for the `gh`
API) as standard, plus — only if the developer opts in through the optional
`compose.override.yaml` — an ssh-agent socket for Git over SSH and a read-only
`known_hosts`. No key material crosses any of them — see
[Git and GitHub access](git-and-github-access.md).

`compose.yaml` plus `.devcontainer/compose.yaml` are a complete standard environment: a
fresh clone starts with no
local file created.

## Dev Container startup

After setting this repository's own `CLOUDFLARED_TOKEN` in the gitignored root `.env`, start the
Dev Container through Dev Containers CLI, from the repository root:

```bash
scripts/devcontainer-up
```

The launcher is the CLI integration surface. It serializes the CLI's fixed-name temporary
Feature image across cooperating repositories; none of its Podman options
can move into `devcontainer.json`. `--docker-path` selects the engine, and
`PODMAN_COMPOSE_PROVIDER` selects the Compose implementation: with Podman as the engine the
CLI invokes `podman compose`, which delegates to an external provider and prefers
`docker-compose` when a Docker installation is present on the host. Omitting the variable
fails against a Docker daemon socket that does not exist.

Rootless verification, the root/sudo refusal, and the workspace-bind credential-file
preflight are no longer performed at startup. They remain requirements:
[Dev Containers CLI startup on rootless Podman](devcontainer-cli-podman-startup.md) states
them, and `scripts/dev-start` still enforces its own copies on the direct Compose path.

## Direct Compose modes

The separate direct Compose entrypoint remains available for the optional Rails and Tunnel
overlays:

```bash
scripts/dev-start
scripts/dev-start --rails
scripts/dev-start --tunnel
scripts/dev-start --rails --tunnel
```

The Tunnel modes require `CLOUDFLARED_TOKEN` in the gitignored root `.env`. It is a scoped
connector token for the Edge-specific Tunnel, not an API token, and must not match Global's token.
`--rails` joins an
existing rootless Podman network named by `EDGE_RAILS_NETWORK`; it never creates or
guesses one. `--tunnel` starts the Edge connector, which is defined in `compose.yaml`.
Credentials are obtained inside the running container through browser logins — see
[Credential and secret management](credential-and-secret-management.md).

Enter the interactive service with:

```bash
podman compose exec core bash -l
```

Node.js is pinned to 24.19.0 and pnpm to 12.0.0, both declared in
`package.json#devEngines` and matched by `Containerfile`. pnpm is installed from the
standalone script, not Corepack, which the image removes outright. Use `pnpm` directly in
scripts and documented commands; the `pn`/`pnpx`/`pnx` short commands that pnpm 11 installs
alongside it are on `PATH` too. Bun is not part of the environment.

The runtime/network architecture is documented in
[cloudflare-development-network.md](cloudflare-development-network.md). Security and
credential rules are in [container-security-policy.md](container-security-policy.md) and
[credential-and-secret-management.md](credential-and-secret-management.md); logging
Wrangler in is [wrangler-authentication.md](wrangler-authentication.md).
