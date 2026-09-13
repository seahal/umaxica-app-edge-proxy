# Development-container security policy

## Boundary

The host and Edge container are separate security principals. Host credential bind mounts
are forbidden. Podman-managed runtime secret delivery and dedicated container-only state
are allowed because neither reuses the host identity.

Forbidden inputs include host HOME, the `.ssh` directory, `.gnupg`, GitHub/Wrangler/
Claude/Codex/OpenCode/Copilot state, private keys, Podman/Docker sockets, arbitrary
credential directories, privileged mode, added capabilities, and host networking.

There is one exception, and it is deliberately narrow: the host's GitHub identity is
**borrowed, never copied**. Exactly three things may be forwarded, and the file each one
lives in is itself part of the policy:

| Input                                                      | Where                                                            | Shape                          | Why it carries no secret                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${GH_TOKEN}`                                              | `compose.yaml` (standard)                                        | Environment variable           | Interpolated from the host environment. No token literal appears in any tracked file, and `:-` rather than `:?` keeps a token-less machine bootable — which is why it is safe to make standard.                                                                                                   |
| `${HOME}/.ssh/known_hosts` → `/home/edge/.ssh/known_hosts` | `compose.override.yaml` (optional)                               | Single file, `read_only: true` | Public host keys. Read-only, so the container cannot rewrite the host's trust store. Optional because Podman invents a missing bind source as a _directory_, so a host without the file cannot carry this mount.                                                                                  |
| `${SSH_AUTH_SOCK}` → `/ssh-agent`                          | `compose.override.yaml` (optional, commented out in the example) | Unix socket bind               | The private key stays in the host agent. Only signature requests and their results cross the socket; the key itself is never transmitted and never lands in the container filesystem. Optional because the socket path is per-machine and a stale one fails the bind before any container starts. |

Everything else about `.ssh` stays forbidden. `test/development-container-security.test.ts`
asserts the exact set of `.ssh` paths in `compose.override.yaml.example` — one source,
one target — so a
private key (`id_rsa`, `id_ed25519`, …), a whole-directory `~/.ssh` bind, or a second
mount of any kind fails the test however it is spelled. `compose.yaml`, the file every
developer shares and the only one the Dev Container loads, must contain neither
`SSH_AUTH_SOCK` nor any `.ssh` path, and `.devcontainer/devcontainer.json` must contain
neither either.

The optional override is never required: the two tracked compose files are a complete standard
environment, so a fresh clone starts with _none_ of the SSH inputs above. Adding them is
an explicit, per-developer act — see
[the compose file contract](../../README.md#the-three-compose-files).

The trade-off this accepts, stated plainly: for the lifetime of the forwarded agent,
anything running in `core` can ask the host key to sign. Bound it on the host — a
dedicated agent holding only the GitHub key, and `ssh-add -t <seconds>` — rather than
inside the container, which is the side that cannot enforce it.

The `core` service runs as `edge` through rootless
`userns_mode: keep-id:uid=1000,gid=1000`, drops all
capabilities, and enables `no-new-privileges`. Only `core` has `tty` and `stdin_open`.
Normal ports and the temporary OAuth callback are published on `127.0.0.1` only.

There is no SSH server in the image, and none may be added: the forwarded agent is an
_outbound_ credential, and nothing about it justifies an inbound path. Development shells
reach `core` through `devcontainer exec` or `podman exec`. The Tailscale client is
present, pinned, and started by nothing — `tailscale up` is an interactive browser login,
in userspace-networking mode, needing no capability and no key file. The AI CLIs likewise
sign in themselves through their own browser flows.

## Filesystem

The repository is a bind mount, not HOME. An empty `nocopy` volume masks `.secrets/`, and a
tracked value-free file masks the root `.env` plus all Rails-frame
`.env.development.local` files. This prevents ignored host credential inputs from leaking
through the source bind mount. Cache, dependency, pnpm-store, Wrangler, and OpenCode volumes
are purpose-specific. Image construction creates writable XDG and tool
directories with the final UID/GID; startup performs no recursive ownership repair and
never changes host file ownership.

`test/development-container-security.test.ts` rejects regressions in these invariants.
The harmless canary in `scripts/verify-build-context` proves `.secrets/` is excluded.
