# Edge development container

`Containerfile` builds the Podman-first development image. It pins Node 24.19.0, pnpm
12.0.0, Claude Code, Codex, and OpenCode, and installs GitHub CLI, Chromium prerequisites,
Wrangler through project dependencies. No credential enters a build
argument, environment instruction, copy, or image layer.

pnpm comes from the standalone install script at <https://pnpm.io/installation> and lands in
`$PNPM_HOME/bin`, which is the only pnpm on `PATH`. The image removes Corepack
(`npm rm --global corepack`) instead of merely not calling it: Node ships Corepack only
below 25.0.0, and leaving the binary in place would let `corepack enable` shadow the
standalone install. The pinned version is `ARG PNPM_VERSION`, held equal to
`package.json#devEngines.packageManager` by `test/development-container-security.test.ts`.

The effective user is `edge`, mapped through rootless `keep-id:uid=1000,gid=1000` — the
host user lands on 1000 inside the container regardless of its id on the host. HOME is `/home/edge` and
the XDG config/cache/data/state paths are writable without sudo. The image creates exact
tool paths at build time.

Start the credential-free Dev Container through Dev Containers CLI from the repository root:

```bash
scripts/devcontainer-up
```

The launcher supplies the engine flag and the `PODMAN_COMPOSE_PROVIDER` variable, which have
no `devcontainer.json` equivalent; everything else is Compose configuration the CLI reads on
its own.
[Dev Containers CLI startup on rootless Podman](devcontainer-cli-podman-startup.md) explains
why each flag is required and what the removed `podman/tools/dcup` used to enforce.

The optional direct-Compose workflows remain available separately:

```bash
scripts/dev-build
scripts/dev-start [--rails] [--tunnel]
podman compose exec core bash -l
node --version
pnpm --version
```

The interactive `core` service has a TTY and open stdin; infrastructure overlays do not.
Validate `tty`, Ctrl-L, Ctrl-C, pnpm, Wrangler, and each AI CLI after building on the real
rootless Podman host.

Every deployment unit's `dev`, `preview` and production build now run the Worker in workerd —
`vite dev` and `vite preview` through `@cloudflare/vite-plugin`, and `wrangler dev` where a unit
still uses it. There is no Node development server left in this repository, and the tooling around
it (pnpm, Wrangler, the AI CLIs) is Node; the project does not call either layer generically
“Node development.”
