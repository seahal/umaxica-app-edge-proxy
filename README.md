![GitHub last commit (branch)](https://img.shields.io/github/last-commit/seahal/umaxica-apps-edge/main)

# Umaxica App (EDGE)

（ ＾ν＾） Hello, World!

The edge layer of Umaxica: a multi-domain monorepo of Cloudflare Workers —
fifteen TanStack Start frames and five Hono apex Workers — spanning three
domain families: `umaxica.com` (corporate), `umaxica.app` (service), and
`umaxica.org` (staff), plus the `umaxica.net` and `umaxica.dev` apexes. Every
deployment unit builds with Vite, runs on workerd, and implements one shared
script contract; nothing here deploys anywhere but Cloudflare Workers.

## Prerequisites

- Node.js 24.20.0 — Active LTS "Krypton" (declared in
  `package.json#devEngines.runtime`, matched by `Containerfile` as
  `node:24.20.0-trixie`)
- [pnpm](https://pnpm.io/) 12.0.0 (declared in
  `package.json#devEngines.packageManager`, matched by `Containerfile`) — the
  ONLY package manager; `pnpm-lock.yaml` is the only lockfile and
  `test/package-manager-invariants.test.ts` enforces both
- Podman with `podman-compose` (optional, for the Dev Container)

## Workspaces

Twenty deployment units, all in `pnpm-workspace.yaml`:

| Package    | Role                | Domain             | Dev Port |
| ---------- | ------------------- | ------------------ | -------- |
| `com/apex` | Apex/static worker  | `umaxica.com`      | 5101     |
| `com/info` | Corporate info      | `info.umaxica.com` | 5103     |
| `com/core` | Corporate app       | `umaxica.com`      | 5105     |
| `com/docs` | Corporate docs      | `docs.umaxica.com` | 5106     |
| `com/news` | Corporate news      | `news.umaxica.com` | 5107     |
| `com/help` | Corporate help      | `help.umaxica.com` | 5108     |
| `net/apex` | Network apex worker | `umaxica.net`      | 5201     |
| `org/apex` | Apex/static worker  | `umaxica.org`      | 5301     |
| `org/info` | Staff info          | `info.umaxica.org` | 5303     |
| `org/core` | Staff app           | `umaxica.org`      | 5305     |
| `org/docs` | Staff docs          | `docs.umaxica.org` | 5306     |
| `org/news` | Staff news          | `news.umaxica.org` | 5307     |
| `org/help` | Staff help          | `help.umaxica.org` | 5308     |
| `app/apex` | Apex/static worker  | `umaxica.app`      | 5401     |
| `app/info` | Service info        | `info.umaxica.app` | 5403     |
| `app/core` | Service app         | `umaxica.app`      | 5405     |
| `app/docs` | Service docs        | `docs.umaxica.app` | 5406     |
| `app/news` | Service news        | `news.umaxica.app` | 5407     |
| `app/help` | Service help        | `help.umaxica.app` | 5408     |
| `dev/apex` | Apex/static worker  | `umaxica.dev`      | 5501     |

`{com,org,app}/apex` are lightweight Hono Workers (root redirect, `/health`,
`/about`); `{com,org,app}/core` are the TanStack Start applications behind them
at regional subdomains. Cloudflare's custom domain for each apex root
(`umaxica.com` / `.org` / `.app`) must point at the `*-apex` Worker, not
`*-core` — reassigning production domain routing is a Cloudflare dashboard/DNS
change outside this repo and must be coordinated before deploying `*/apex`.

Those custom domains are currently **removed**: since 2026-08-11 the apex
hostnames are Public Hostnames on the development Cloudflare Tunnel, and a
custom domain and a Public Hostname cannot both own one name. Each
`*/apex/wrangler.jsonc` therefore declares `"routes": []`. Returning an apex to
its Worker means removing the Public Hostname entry first, then restoring the
route — in that order. See `adr/008-edge-development-tunnel-exposure.md`.

One deliberate outlier lives outside the workspace list: `all/busy` is a
dependency-free static maintenance Worker (`umaxica-apps-edge-all-busy`) with a
hand-written `src/index.js` and `public/` — no build step, no package.json, not
part of the pnpm workspace or the script contract.

## Quick Start

```bash
pnpm install

# Git hooks. `.npmrc` sets `ignore-scripts=true`, so the `prepare` script does
# NOT run on install and the hooks are not installed for you.
pnpm exec lefthook install

# Browsers for `pnpm run test:e2e`. Neither the image nor CI installs one;
# Containerfile provides Chromium's shared libraries but no browser binary.
pnpm exec playwright install chromium

# Run a specific workspace
pnpm --filter <workspace> run dev   # e.g. com/core, app/core

# Podman (optional)
podman compose up -d && podman compose exec core bash -l
```

## Scripts

The toolchain is plain pnpm scripts backed by standalone Oxfmt, Oxlint, tsc,
Vitest, Hurl and Playwright. The only build tool is Vite, and nothing wraps it:
a script calls `vite build` directly, never a framework CLI on top of it.

Every deployment unit exposes the same script contract, and the root scripts
are thin `pnpm -r` fan-outs over them plus the repository-level files:

```bash
pnpm run format          # each unit's `format`, then oxfmt . at the root
pnpm run format:check    # each unit's `format:check`, then oxfmt --check .
pnpm run lint            # each unit's `lint`, then oxlint at the root
pnpm run lint:types      # the same, with `--type-aware` (needs a whole program)
pnpm run lint:fix        # the only script that rewrites code
pnpm run typecheck       # each unit's `typecheck` (cf-typegen, then tsc --noEmit)
pnpm run test            # each unit's Vitest run, then the root invariant suite
pnpm run test:api        # each unit's Hurl suite
pnpm run test:e2e        # each unit's Playwright run
pnpm run build           # each unit's `vite build` — all twenty, one bundler
pnpm run check           # check:static + test
pnpm run check:static    # format:check + lint + lint:types + check:generated
                         #   + typecheck + knip + check:workers
                         #   + check:architecture + check:deps + check:spelling
pnpm run check:size      # bundle budgets via size-limit (run `build` first;
                         #   deliberately NOT part of check:static)
```

A few checks run once from the root rather than fanning out:
`check:architecture` (dependency-cruiser), `check:deps` (syncpack against the
`pnpm-workspace.yaml` catalog), and `check:spelling` (cspell). `fix:deps` is
local-only. `pnpm run knip` hunts dead code per unit.

`check` deliberately stops short of `test:api` and `test:e2e`: those start
servers, so they are a separate gate rather than part of the one a pre-push
hook can afford. See [Testing](#testing) for what each layer is responsible
for.

Run any of them for a single deployment unit — this is the same command the
root fan-out uses, and it works from the unit's own directory:

```bash
pnpm --dir app/core run check     # or: pnpm --filter <pkg> run check
cd app/core && pnpm run test      # unit owns its vitest config, setup and mocks
```

Each unit carries its own `vitest.config.ts`, `vitest.setup.ts`,
`.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig.json` and `knip.jsonc`, and
declares every binary its scripts invoke. Nothing in a unit resolves through a
repository-root config, so a unit can be extracted into its own repository
without rewriting its toolchain. `test/deployment-unit-boundaries.test.ts`
enforces this.

Shared dependency versions live in the `catalog:` section of
`pnpm-workspace.yaml`, so twenty units cannot drift onto different versions of
the same tool; `check:deps` fails if a manifest steps outside the catalog. The
workspace file also enforces supply-chain policy: `minimumReleaseAge: 1440`
(strict) holds newly published versions back a day before they can install.

## Development Environment

### Toolchain

| Tool                                                            | Role                                 | Version  |
| --------------------------------------------------------------- | ------------------------------------ | -------- |
| [pnpm](https://pnpm.io/)                                        | Package manager & task orchestration | 12.0.0   |
| [Vite](https://vite.dev/)                                       | Dev server & production build        | 8.2.x    |
| [TanStack Start](https://tanstack.com/start)                    | Framework, the fifteen frames        | 1.168.x  |
| [Hono](https://hono.dev/)                                       | Framework, the five apex Workers     | 4.13.x   |
| [Tailwind CSS](https://tailwindcss.com/)                        | Styling, via `@tailwindcss/vite`     | 4.3.x    |
| [Oxfmt](https://oxc.rs/)                                        | Formatter (`pnpm run format`)        | 0.65.x   |
| [Oxlint](https://oxc.rs/)                                       | Linter (`pnpm run lint`)             | 1.80.x   |
| [TypeScript](https://www.typescriptlang.org/)                   | Type checker (`pnpm run typecheck`)  | 7.0.x    |
| [Vitest](https://vitest.dev/)                                   | Unit tests (`pnpm run test`)         | 4.1.x    |
| [Hurl](https://hurl.dev/)                                       | HTTP tests (`pnpm run test:api`)     | 8.0.x    |
| [Playwright](https://playwright.dev/)                           | Browser E2E (`pnpm run test:e2e`)    | 1.62.x   |
| [Lefthook](https://github.com/evilmartians/lefthook)            | Git hooks                            | 2.1.x    |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | Cloudflare Workers CLI               | 4.127.x+ |

### Node and pnpm versions

`package.json#devEngines` is the single declaration of both:

```jsonc
"devEngines": {
  "runtime":        { "name": "node", "version": "24.20.0", "onFail": "warn" },
  "packageManager": { "name": "pnpm", "version": "12.0.0", "onFail": "download" }
}
```

Three separate things keep that declaration true, and they are worth not
confusing with one another:

- **Declaration** — `devEngines`, replacing the legacy `packageManager` field.
  pnpm records the resolved package-manager version in `pnpm-lock.yaml`, which
  the legacy field alone did not guarantee.
- **Installation** — the Dev Container installs pnpm from the standalone script
  at a version fixed by `ARG PNPM_VERSION`; CI installs it with
  [`pnpm/setup`](https://github.com/pnpm/setup), which reads `devEngines`
  directly. Neither uses Corepack. `pnpm/setup` supplies Node as well, so CI
  has no separate `setup-node` step and no floating major version.
- **Enforcement** — pnpm's default `pmOnFail: download` runs the declared
  version if the invoking one differs, and
  `test/development-container-security.test.ts` fails if `Containerfile` and
  `package.json` ever disagree. `runtime.onFail` is `warn`, deliberately not
  `download`: `download` would have pnpm fetch a second Node.js into
  `node_modules` instead of using the image's.

Bumping a version therefore means editing `package.json` and `Containerfile`
together; the test tells you when you have edited only one.

### Podman / DevContainer

The development environment is started with the Dev Containers CLI over
rootless Podman.

- **Base image**: `node:24.20.0-trixie` from `Containerfile`, with pnpm 12.0.0
  pre-installed via the standalone script documented at
  <https://pnpm.io/installation>. Both are pinned to exact versions so a
  rebuild reproduces the same toolchain, and both match the sibling Rails repo
  (`seahal/umaxica-apps-jit-global`).
- **No Corepack**: the image deletes it (`npm rm --global corepack`) rather
  than merely declining to call it. Node ships Corepack only below 25.0.0 and
  pnpm no longer documents it as an installation method, so it is a dependency
  with an expiry date; removing it also stops `corepack enable` from putting a
  second `pnpm` on `PATH`. The standalone install under `$PNPM_HOME/bin` is
  the single source of pnpm in the image.
- **Package manager**: use the directly available `pnpm` command; the `pn` and
  `pnx` short commands are also on `PATH`. Scripts and documented commands
  stay on `pnpm`. npm, yarn and Bun are intentionally absent from the
  workflow.
- **DevContainer**: configured in `.devcontainer/devcontainer.json`
  - Extensions: Claude Code, ChatGPT, Oxc and Oxfmt, Tailwind CSS, and the
    GitHub and container tooling
  - Disabled: ESLint, Prettier, GitLens, GitHub Copilot
  - No security scanner runs in the image: secret scanning is a CI job
    (gitleaks), and the pre-commit and pre-push gates are Lefthook's, declared
    in `lefthook.yml`. `docs/development/static-analysis-and-hygiene.md` has
    the full gate table; `SECURITY.md` describes the posture as a whole.
- Runs as the non-root `edge` user (uid/gid 1000) via
  `userns_mode: keep-id:uid=1000,gid=1000`, which maps the host user onto 1000
  whatever its host id is, so no host-side hook has to discover it;
  the container has no `sudo` or `visudo`, and `su` cannot authenticate as
  root.

Start the Dev Container straight from a fresh clone — no local file has to be
created first:

```bash
git clone https://github.com/seahal/umaxica-apps-edge.git
cd umaxica-apps-edge
docker compose config    # or: podman compose config -- resolves as-is

scripts/devcontainer-up
```

`CLOUDFLARED_TOKEN` in the gitignored root `.env` is only needed if you
actually want the Cloudflare Tunnel connector; without it the connector starts
with an empty token and everything else is unaffected.

The launcher supplies the mandatory Podman options and serializes Dev Container
Feature builds against the CLI's host-global temporary image name. Run it as
the normal rootless user, never through `sudo`. See
[Dev Containers CLI startup on rootless Podman](docs/development/devcontainer-cli-podman-startup.md).

The direct Compose launcher remains available, and is the path that applies a
local override:

```bash
scripts/dev-start [--rails] [--tunnel]
podman compose exec core bash -l
```

#### Running without an editor

`core` is a workspace container: it parks on `sleep infinity` and you start dev
servers inside it by hand. If you would rather not run an editor at all, each
workspace unit is also a Compose service of its own, behind the `app` profile:

```bash
podman compose up                          # the shared services only
podman compose --profile app up com-apex   # just com/apex, on 5101
podman compose --profile app up            # all twenty dev servers
```

Each service runs that unit's own `pnpm run dev` and publishes the port that
script already binds, so the URLs are the ones in the port table above. A bare
`podman compose up` deliberately starts no dev server — that is the shape the
Dev Container needs, and the shape you want before a build or a test run.

`core` and the per-unit services publish the same host ports, so the two shapes
are mutually exclusive: stop the Dev Container before `--profile app`.

#### The three compose files

```text
compose.yaml                   = the shared services, plus the `app` profile
.devcontainer/compose.yaml     = `core`, the workspace container
compose.override.yaml          = optional, gitignored, yours
compose.override.yaml.example  = documented example, tracked
```

| File                            | Holds                                                                                                                                                                                                 | Edit it?                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `compose.yaml`                  | the shared services — the Edge-owned `cloudflare-tunnel` connector, the networks and volumes — plus one dev-server service per workspace unit behind `profiles: [app]`                                | only as a change that applies to everyone  |
| `.devcontainer/compose.yaml`    | `core`, the workspace container: the SELinux `label=disable`, the twenty published ports, the `GH_TOKEN` passthrough, `sleep infinity`. It lives here so a bare `podman compose up` does not start it | only as a change that applies to everyone  |
| `compose.override.yaml`         | host-specific convenience only — an ssh-agent socket, a `known_hosts` bind, machine-local ports, experiments                                                                                          | yes, freely; it is yours and is gitignored |
| `compose.override.yaml.example` | a documented example of the above                                                                                                                                                                     | only to change what the example teaches    |

**A fresh clone needs no override.** `compose.yaml` and
`.devcontainer/compose.yaml` between them are a complete, supported development
environment on Ubuntu, on RHEL/Fedora with SELinux Enforcing, under Docker and
under rootless Podman. Nothing copies the example
into place, and nothing fails because the override is absent — this is asserted
by `test/compose-local-override-invariants.test.ts`.

Two consequences of that contract are worth knowing:

- **SELinux lives in the tracked compose files.** `core` carries
  `security_opt: [no-new-privileges:true, label=disable]`. The bind mounts here
  deliberately carry no `:z`/`:Z`, which would relabel your host tree;
  `label=disable` is scoped to this one container and is simply ignored on hosts
  without SELinux. RHEL is a supported host, so making it work is not a chore we
  hand to the developer.
- **The Dev Container does not load your override.** The Dev Containers CLI
  passes each `dockerComposeFile` entry to Compose as `-f`, and Compose only
  auto-discovers `compose.override.yaml` when _no_ `-f` is given. So
  `.devcontainer/devcontainer.json` lists the two tracked files alone, and a bare
  `docker compose` (auto-discovery) or `scripts/dev-start` (explicit `-f` when
  the file exists) is where an override takes effect. VS Code already forwards
  your ssh-agent into the container for Git on its own.

To create one:

```bash
cp compose.override.yaml.example compose.override.yaml   # optional
```

Keep the `name: umaxica-apps-edge` line: Compose takes the project name from the
last file that sets one, so a divergent value forks the project into a second
set of containers and volumes.

The example forwards no ssh-agent socket by default. The socket path exists on
some machines and not others, and a stale one fails the bind before any
container starts — so if you want Git over SSH inside the container, uncomment
the bind in your own copy:

```yaml
services:
  core:
    environment:
      SSH_AUTH_SOCK: /ssh-agent
    volumes:
      - type: bind
        source: ${SSH_AUTH_SOCK}
        target: /ssh-agent
```

Only the socket, never a private key: the key never leaves your host agent.

##### Migrating from `compose.custom.yaml`

`compose.custom.yaml` is retired. It was gitignored, so nothing deletes yours —
but it is no longer loaded by anything.

```bash
mv compose.custom.yaml compose.override.yaml
```

Then **delete `label=disable` and `GH_TOKEN` from your copy**: both are now in
`compose.yaml`. `security_opt` entries are _appended_ rather than replaced, so a
restated `label=disable` makes Compose v2.24+ reject the merge with
`services.core.security_opt items at 0 and 1 are equal`. `scripts/dev-start`
prints a reminder if it finds the old file.

If you have nothing host-specific in it, just delete it:

```bash
rm compose.custom.yaml
```

There is no credential overlay. GitHub access is the host's, borrowed through
`GH_TOKEN` (and an ssh-agent socket, if you add one to your override); every
other credential is obtained inside the running container through a browser flow
and is discarded when the container is recreated — see
[Git and GitHub access](docs/development/git-and-github-access.md) and
[Credential and secret management](docs/development/credential-and-secret-management.md).

#### Getting an interactive shell

Use `podman compose exec` (or `podman exec -it`) — both allocate a
pseudo-terminal:

```bash
podman compose exec core bash -l
podman exec -it umaxica-apps-edge-core-1 bash -l
```

`devcontainer exec` is for **one-shot commands only**. It wires stdin to a
plain pipe and never allocates a PTY, so the shell has no line discipline:
Ctrl+C is delivered as a raw `0x03` byte instead of `SIGINT`, line editing and
history are dead, and Ctrl+D closes the pipe rather than sending EOF — the
shell exits instantly and it looks like the container died. Confirm with
`tty`: an interactive shell answers `/dev/pts/N`, a broken one answers
`not a tty`. VS Code's integrated terminal allocates its own PTY and is
unaffected.

Note also that `tty: true` / `stdin_open: true` in `compose.yaml` apply to
PID 1 (`sleep infinity`) only — they have no bearing on shells started later
via `exec`.

### Cloudflare

The standard Dev Container starts an Edge-owned Tunnel connector. Put its
dedicated connector token in the gitignored root `.env` as
`CLOUDFLARED_TOKEN`; this is not a Cloudflare API token, and it must not be
the value Global uses for the same variable name in its own `.env`. `vpc_services` remains independent and exists only in
the explicit `env.vpc` development environment; production remains
fail-closed.

Start only the deployment unit you are working on; the repository root does
not fan development servers out across workspaces.

```bash
pnpm --dir app/core run dev
```

`compose.yaml` defines the Edge-owned connector alongside `core`. It reaches
development services at `http://core:<port>` over this compose project's
default network. Global shares neither this network nor this tunnel. Public
Hostnames on the Edge tunnel remain protected by Cloudflare Access. See
`docs/operations/cloudflare-tunnel-development.md` and
`adr/014-edge-owned-development-tunnel.md`.

To reach Rails from local Node development, set `EDGE_RAILS_NETWORK` to the
existing Rails rootless Podman network and use `scripts/dev-start --rails`.
Access credentials are reserved for the independent `scripts/check-tunnel`
path.

Connectivity diagnostics are first-class root scripts:
`pnpm run check:connectivity` runs the whole suite, and
`check:config` / `check:vpc` / `check:local` / `check:preview` /
`check:host` / `check:tunnel:edge` / `check:tunnel:apex` / `check:links`
run each probe individually (all via
`tools/verify-edge-connectivity.mjs`). `pnpm run login` wraps
`scripts/wrangler-login` (`login:device` for the device flow).

The authoritative topology and security documentation begins at
[`docs/development/development-environment-overview.md`](docs/development/development-environment-overview.md).

## Testing

Three tools, split by **responsibility, not by capability**. Each can
technically do the others' job; none may.

| Layer           | Tool       | Lives in       | Answers                                      |
| --------------- | ---------- | -------------- | -------------------------------------------- |
| `pnpm test`     | Vitest     | `<unit>/test/` | did the internal logic break?                |
| `pnpm test:api` | Hurl       | `<unit>/api/`  | did the HTTP contract break?                 |
| `pnpm test:e2e` | Playwright | `<unit>/e2e/`  | did the user's path through a browser break? |

The rule that decides where something goes is **what the assertion is about**,
not what the tool can reach:

- If the assertion is on a **response** — status, headers, body, cookies,
  redirects — it belongs in a `.hurl` file and runs against a real server. It
  must not import from `src/` or call `app.request()`.
- If the assertion is on **something no HTTP client can produce** — a route
  that throws, an injected `RATE_LIMITER`, a Workers binding, a `console`
  line — it stays in Vitest. There `app.request()` is allowed only as the
  driver and the assertion is elsewhere; every such case says so in a comment.
- If the assertion needs a **real engine** — rendering, the accessibility
  tree, service-worker activation, offline navigation — it belongs in
  Playwright. Status codes and `Content-Type` never belong in a `.spec.ts`.

Duplication across layers is allowed only when the layers have different
failure modes. `POST /sign/in → Set-Cookie → GET /me` is a Hurl test, the JWT
parser behind it is a Vitest test, and the login screen is a Playwright test;
the same `GET /health → 200` in all three is not.

Each unit's `api/README.md` states this contract locally and names the Vitest
file each `.hurl` file replaced. All twenty units implement the same contract,
including `dev/apex`; none is exempt.

Root-level `vitest run --dir test` runs only `test/` — the repository
invariants (package manager, deployment-unit boundaries, compose files,
container security). There is no root Vitest config. A unit's tests live in
`<unit>/test/` and run via `pnpm --dir <unit> run test`.

### Running them

```bash
pnpm run test                              # every unit, then the root invariants
pnpm --dir app/core run test               # one unit
pnpm exec vitest run path/to/file.test.ts  # one file
pnpm exec vitest run -t "test name"        # one test

pnpm --dir app/core run test:api           # starts a server, runs Hurl, stops it
EDGE_API_BASE=https://preview.example ...  # ...or point it at a deployment
pnpm --dir app/core run test:e2e           # Playwright, with its own webServer
```

`test:api` needs no running server: each unit's `api/run.mjs` starts one,
waits for it, and stops it — and reuses one that is already listening, so a
unit's `pnpm run dev` in another terminal keeps working. Setting
`EDGE_API_BASE` targets an existing deployment and spawns nothing.

**Vitest** runs with the `happy-dom` environment and globals enabled, from
each unit's own `vitest.config.ts` and `vitest.setup.ts`
(`@testing-library/jest-dom`, `@testing-library/react`). Import test utilities
from `vitest` directly, never through a wrapper.

Two caveats worth knowing before a first run:

- **Playwright browsers are not installed** by the image or by CI. Run
  `pnpm exec playwright install chromium` once before `test:e2e`.
- **CI deliberately skips `test:e2e`** for the same browser reason — do not
  "fix" that. CI does run `test:api` for all twenty units.

## TypeScript

Strict mode is enabled across the monorepo. Key compiler options:
`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
Module resolution is `Bundler`. TypeScript 7 (`tsc` is the native Go compiler)
comes from the catalog; every unit declares it explicitly rather than leaning
on root hoisting.

Generated files follow two opposite rules:

- `cloudflare-env.d.ts` (frames) and `worker-configuration.d.ts` (apex) come
  from `wrangler types` and are **gitignored — never commit them**. Frames run
  `cf-typegen` inside `typecheck`; apex workers compile without the file.
- `src/routeTree.gen.ts` **IS committed** in every frame (regenerated by the
  TanStack Router plugin on `vite dev`/`vite build`; excluded from Oxfmt,
  Oxlint, and coverage). Rationale: `adr/013-frames-tanstack-start.md`.

> Do not modify the configurations for Oxlint, Oxfmt, TypeScript, Vitest, Hurl
> or Playwright without explicit user permission.

## Production Environment

| Platform                                              | Workspaces                                                     | Domains                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Cloudflare Workers](https://workers.cloudflare.com/) | all twenty — `app/*`, `com/*`, `org/*`, `net/apex`, `dev/apex` | `umaxica.app`, `umaxica.com`, `umaxica.org`, `umaxica.net`, `umaxica.dev` |

There is no second platform. `dev/apex` moved from Vercel to Workers and
`dev/acme` was deleted (`adr/012-apex-vite-build-and-static-assets.md`), so
every deployable unit in this repository is a Cloudflare Worker built by Vite.
`vite build` produces the deployed Worker bundle and hashed assets — it builds
for production, not just dev; production starts no Node process and no server.

### Deployment

```bash
pnpm --filter <workspace> run deploy           # direct deploy
pnpm --filter <workspace> run deploy:upload    # versioned: upload, then promote
pnpm --filter <workspace> run deploy:promote
```

Root-level shortcuts exist for the docs workspaces
(`deploy:{app,com,org}-docs:upload`) plus `deploy:edge:preview` for the
preview environment via `scripts/deploy-edge-preview`.

Notes:

- Do not point Cloudflare at the removed `post` workspace. If Wrangler reports
  that CI expected a `*-post` Worker while the workspace config uses `*-docs`,
  the Cloudflare Workers Build is still connected to the removed `post`
  Worker — reconnect or recreate that build for the matching docs Worker
  before deploying.
- `npm --dir` is not a valid flag — but neither is reaching for npm here. pnpm
  is the only package manager this repository supports, `pnpm-lock.yaml` is
  the only lockfile it tracks, and `test/package-manager-invariants.test.ts`
  fails the build if another one appears. Use
  `pnpm --dir app/docs run deploy:upload`. If a platform genuinely cannot run
  pnpm, that is a platform decision to make deliberately, not a flag to swap.
- **Cloudflare Workers Builds must call a repo script, never `wrangler`
  directly.** The build environment exports `CLOUDFLARE_ENV=production`, and
  wrangler reads it as `--env=production`. The top level of every
  `wrangler.jsonc` here _is_ production and there is deliberately no
  `env.production`, so a deploy command of
  `pnpm --dir org/core exec wrangler versions upload` fails with
  `No environment found in configuration with name "production"`. A raw
  `wrangler versions upload` is wrong for a second reason too: `vite build`
  writes the deployable config to `dist/server/wrangler.json` and points
  `.wrangler/deploy/config.json` at it, so wrangler only uploads the built
  Worker and its hashed assets if the build ran first. Passing
  `--config wrangler.jsonc` bypasses that redirect and uploads the INPUT
  config, whose `main` is the unbundled source. Configure the Workers Builds
  commands as:

  ```text
  Build command:   pnpm --dir org/core run build
  Deploy command:  pnpm --dir org/core run upload:ci
  ```

  `upload:ci` is `pnpm run build && CLOUDFLARE_ENV= wrangler versions upload` —
  it builds, blanks the injected variable and uploads the output the build
  step just produced. All twenty deployable workspaces define it, and since
  every one of them builds with Vite the definition is identical in each. Keep
  it in place when adding a workspace, and substitute the workspace path in
  both commands above. Watch the build configuration's root directory too — a
  one-letter typo there has broken every build on a branch before.

### Environment Variables

Cloudflare workspaces use `wrangler.jsonc` (`vars` + environments).

For local Compose development, the workspace URL convention is:

```text
JIT_{COM,ORG,APP}_{CORE,DOCS,NEWS,INFO,HELP}_URL
```

Compose defaults map those names to the local dev ports for each workspace.
Use the same naming pattern in other workspaces when you need a self URL or a
cross-workspace link target.

## Surface Architecture

Core workspaces run TanStack Start on Cloudflare Workers. They own RP/BFF
behavior, authenticated UI, React Aria surfaces, logged-in state, and account,
organization, and avatar operations.

Public information workspaces (`docs`, `news`, `info`, and `help`) run the
same stack. They are limited to public content and read-only content APIs.
Every HTML route is server-rendered per request — there is no prerendering and
no image optimization layer, because the security headers and the rate limiter
in each frame's `src/server.ts` only apply to requests the Worker actually
sees.

Rails Core/Base remains the source of truth for policy, mutation, authority,
and content JSON APIs. Public information surfaces may consume only public,
read-only Rails content APIs through the Cloudflare Workers private
connectivity boundary. They must not receive Acme refresh tokens, user-scoped
secrets, or authenticated Core session material.

Cross-cutting contracts, enforced by lint rules and repository tests rather
than convention:

- **Logging** — `no-console` is an error in every unit. The only two
  sanctioned emitters are `*/apex/src/structured-logger.ts`
  (`@hono/structured-logger`) and `*/core/src/lib/rails-dispatch-log.ts`; both
  emit one JSON line collected by `observability.logs.enabled`, and
  `RailsDispatchLogEntry` has no free-text field by design.
- **Cookies** — browser code touches cookies only via the Cookie Store API
  (`cookieStore`); server side stays on `hono/cookie` and Rails.
  `*/core/src/worker.ts` strips every `Set-Cookie` from application responses,
  so a browser-visible cookie can only come from an apex Worker or Rails
  (ADR 007). `docs/development/browser-cookie-access.md` is normative.
- **Styling** — Tailwind CSS v4 is the only styling layer: no CSS Modules, no
  CSS-in-JS, no `tailwind.config.*`, no static `style=`. Each unit owns its
  own stylesheet and `@theme`; the engine runs via `@tailwindcss/vite` with no
  PostCSS pipeline. `docs/design/ui-shell-contract.md` §3a is normative.

Design decisions live in `adr/` (fourteen records to date) and the deeper
documentation under `docs/`.

## Review Checklist for Agents

- [ ] Run `pnpm install` after pulling remote changes and before getting
      started.
- [ ] Run `pnpm run check` before finishing any change — `check:static`
      (format, lint, types, generated files, knip, workers, architecture,
      deps, spelling), then `test`.
- [ ] Run `pnpm run build && pnpm run check:size` if the change reaches a
      browser bundle.
- [ ] Run `pnpm run test:api` when you touched anything a client can observe:
      a route, a header, a redirect, a status, a rendered document.

## Notes

- Secrets must stay in Rails credentials; do not commit plaintext secrets.
- WebAuthn origins are controlled by `TRUSTED_ORIGINS`.
- Public availability of this repository is not guaranteed permanently.
