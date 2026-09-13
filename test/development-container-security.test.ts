import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

/**
 * Every path git tracks. The root `test` script injects `EDGE_TRACKED_FILES`
 * so the suite runs one `git ls-files` instead of one per file that asks;
 * running this file on its own falls back to invoking git directly.
 */
function trackedFiles(): string[] {
  const injected = process.env['EDGE_TRACKED_FILES'];
  if (injected !== undefined) {
    return injected.split('\n').filter(Boolean);
  }
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** The tracked entries directly inside `prefix`, as bare names, sorted. */
function trackedUnder(prefix: string): string[] {
  return trackedFiles()
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map((path) => path.slice(prefix.length))
    .sort();
}

/**
 * Every compose file this repository tracks. `compose.yaml` carries the shared
 * services and, behind the `app` profile, the twenty dev servers;
 * `.devcontainer/compose.yaml` carries `core`, the workspace container, which
 * lives there so a bare `podman compose up` does not start it. Between them they
 * hold the SELinux relabel opt-out and the forwarded `GH_TOKEN`.
 * `compose.override.yaml.example` documents the OPTIONAL developer-local
 * override; the override itself (`compose.override.yaml`) is gitignored, absent
 * on a fresh clone, and holds arbitrary host-specific edits, so the example is
 * what these assertions can hold. A new compose file would have to be added here
 * to be covered.
 */
const composeFiles = [
  'compose.yaml',
  '.devcontainer/compose.yaml',
  'compose.override.yaml.example',
] as const;
const compose = composeFiles.map((path) => read(path)).join('\n');

/**
 * One service's block, from whichever tracked compose file defines it, so an
 * assertion about the workspace container cannot be satisfied — or violated — by
 * the tunnel connector or a dev-server service beside it.
 */
function service(name: string): string {
  for (const path of composeFiles) {
    const block = new RegExp(`^  ${name}:\n((?:    .*\n|\n)*)`, 'mu').exec(read(path))?.[1];
    if (block !== undefined && block !== '') {
      return block;
    }
  }
  return '';
}
const containerfile = read('Containerfile');
// Comments explain why Corepack is gone, so assertions about what the image
// actually does have to read the instructions rather than the prose.
const instructions = containerfile
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');
const devcontainer = read('.devcontainer/devcontainer.json');

describe('development-container security contract', () => {
  it('uses Containerfile as the only repository-owned build definition', () => {
    expect(existsSync(join(repoRoot, 'Containerfile'))).toBe(true);
    expect(existsSync(join(repoRoot, 'Dockerfile'))).toBe(false);
    expect(read('compose.yaml')).toContain('dockerfile: Containerfile');
  });

  it.each(['.gitignore', '.containerignore', '.dockerignore'])(
    '%s excludes the local secret input directory',
    (path) => {
      expect(read(path)).toMatch(/^\.secrets\/?$/mu);
    },
  );

  it('does not give any compose service the host gateway', () => {
    // `extra_hosts: host.docker.internal:host-gateway` exposes the host's
    // network to the container. Tunnel origin is the compose service itself
    // (or a shared Podman network), so the mapping is unused exposure.
    // Comments may name the anti-pattern; only non-comment lines are checked.
    for (const path of composeFiles) {
      const instructionsOnly = read(path)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(instructionsOnly, `${path} extra_hosts`).not.toMatch(/^\s*extra_hosts\s*:/mu);
      expect(instructionsOnly, `${path} host-gateway`).not.toContain('host-gateway');
      expect(instructionsOnly, `${path} host.docker.internal`).not.toContain(
        'host.docker.internal',
      );
    }
  });

  it('does not mount host identities, homes, agents, or container-engine sockets', () => {
    const forbidden = [
      'localEnv:HOME',
      '/.gnupg',
      '/.config/gh',
      '/.claude',
      '/.codex',
      '/.config/opencode',
      '/.copilot',
      'podman.sock',
      'docker.sock',
    ];
    for (const value of forbidden) {
      expect(devcontainer, `devcontainer contains ${value}`).not.toContain(value);
      expect(compose, `compose contains ${value}`).not.toContain(value);
    }

    /*
     * `SSH_AUTH_SOCK` is the one host-identity input this repository accepts,
     * and it is accepted in exactly one place. The forwarded agent carries no
     * key material — the private key stays in the host agent and only signature
     * requests cross the socket — which is what distinguishes it from every
     * entry above. The contract it has to satisfy is asserted in full by
     * `forwards only the host ssh-agent socket…` below.
     *
     * Here we only pin WHERE it may appear: never in the editor's own
     * configuration, and never in the file every developer shares.
     */
    expect(devcontainer, 'devcontainer contains SSH_AUTH_SOCK').not.toContain('SSH_AUTH_SOCK');
    expect(read('compose.yaml'), 'the shared compose file forwards an agent').not.toContain(
      'SSH_AUTH_SOCK',
    );
  });

  /*
   * Host SSH input is permitted, but only in the two shapes that carry no
   * secret: the ssh-agent socket (the private key never leaves the host agent;
   * only signature requests cross it) and `known_hosts` read-only (public host
   * keys). A private key, and the `.ssh` directory that would smuggle one in,
   * stay forbidden — and so does an SSH server inside `core`, which would give
   * the container an inbound network path it has no reason to have.
   *
   * Written as a positive contract rather than a keyword ban: the exact set of
   * `.ssh` paths is asserted, so a second mount cannot be added without this
   * test failing, however it is spelled.
   */
  it('forwards only a read-only known_hosts, and no ssh-agent socket', () => {
    expect(devcontainer, 'devcontainer references .ssh').not.toContain('/.ssh');

    // Comments are stripped first: the compose files discuss credentials at
    // length, and that prose must not be what fails the check.
    const directives = (path: string): string =>
      read(path)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

    // The standard file stays absolutely clean. Which SSH paths exist is a
    // per-machine fact, so they belong to the optional override and nowhere
    // else -- a bind whose source is missing fails the whole `up`.
    expect(directives('compose.yaml'), 'compose.yaml references .ssh').not.toContain('/.ssh');

    const overlay = directives('compose.override.yaml.example');

    // Exactly one source and one target, in that order, and nothing else.
    expect([...overlay.matchAll(/\S*\/\.ssh\/\S*/gu)].map((match) => match[0])).toEqual([
      '${HOME}/.ssh/known_hosts',
      '/home/edge/.ssh/known_hosts',
    ]);

    // A bare `~/.ssh` bind, or any private key, whatever the key type.
    expect(overlay, 'the overlay mounts a private key').not.toMatch(
      /id_(?:rsa|dsa|ecdsa|ed25519)|\bidentity\b|\/\.ssh['"]?\s*$/mu,
    );

    // known_hosts is public data the container may read and must not rewrite.
    expect(overlay).toMatch(
      /source: \$\{HOME\}\/\.ssh\/known_hosts\n\s+target: \/home\/edge\/\.ssh\/known_hosts\n\s+read_only: true/u,
    );

    // The example forwards no ssh-agent socket outside a comment. Whether one
    // exists, and at which path, is a per-machine fact, and Podman fails the
    // bind -- and so the whole `up` -- before any container starts when the
    // source is missing. So the socket stays commented out: a developer opts in
    // by uncommenting it in their own copy.
    expect(overlay, 'the example forwards an ssh-agent socket').not.toMatch(
      /SSH_AUTH_SOCK|\/ssh-agent/u,
    );

    // `:-` rather than `:?`, on every host-supplied value. Compose interpolates
    // the whole file whichever services are named, so a required variable would
    // stop `up core` on every machine that has no token.
    expect(overlay, 'a required interpolation would break token-less hosts').not.toMatch(
      /\$\{(?:SSH_AUTH_SOCK|GH_TOKEN|HOME):\?/u,
    );

    // The remote-SSH half of the old Tailscale overlay was removed deliberately:
    // no sshd, no entrypoint override, no authorized-keys bind, no TS_AUTHKEY.
    // Its pieces must not come back one file at a time.
    expect(directives('compose.override.yaml.example')).not.toMatch(/sshd|tailscale|TS_AUTHKEY/iu);
    expect(instructions, 'the image installs an SSH server again').not.toMatch(/openssh-server/u);
    expect(instructions).not.toMatch(/TS_AUTHKEY|tskey-|--advertise-tags|tailscale serve/u);

    // The Tailscale CLI itself stays: `tailscale up` is an interactive browser
    // login, like every other credential here, and needs no bootstrap file. It
    // must stay version-pinned, from a repository keyed by a baked-in keyring,
    // because it is what listens to the tailnet.
    expect(instructions, 'the Tailscale client is not version-pinned').toMatch(
      /^\s+tailscale=\d+\.\d+\.\d+\s*\\?$/mu,
    );
    expect(instructions).toContain('signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg');

    // Userspace networking is why none of the capabilities below are needed:
    // netstack terminates the connection in-process, so tailscaled runs as
    // `edge` with no /dev/net/tun. `--ssh` would terminate sessions in
    // tailscaled itself, which is the one thing this arrangement avoids.
    const tun = [...instructions.matchAll(/--tun=(\S+)/gu)].map((match) => match[1]);
    expect(tun, 'the image never starts tailscaled').toEqual(['userspace-networking']);
    expect(instructions, 'the tailscale wrapper escalates').not.toMatch(/\bsudo\b/u);
    expect(instructions).not.toMatch(/--ssh\b|funnel/iu);

    // `.devcontainer/` holds its two JSON files, plus the Compose file that
    // defines `core`, and nothing else. Every script that used to live beside
    // them is gone, and the wrapper the image needs is a heredoc in the
    // Containerfile rather than another file here.
    //
    // This reads what git tracks, not what `readdirSync` finds. A fresh clone
    // is the thing under test, and only tracked files reach one; a developer's
    // gitignored leftover -- `.devcontainer/devcontainer.custom.yaml` is
    // ignored by name at `.gitignore` precisely so an existing local copy
    // stays invisible -- is not a change to the image's attack surface and
    // must not fail this contract.
    expect(trackedUnder('.devcontainer/'), '.devcontainer/ gained a tracked file').toEqual([
      'compose.yaml',
      'devcontainer-lock.json',
      'devcontainer.json',
    ]);
  });

  it('masks .secrets/ behind an empty read-only volume', () => {
    /*
     * `.secrets/` is the ONE workspace path still masked. It is the input side
     * of Podman Secret delivery, so a container that could read it would make
     * the whole mechanism pointless.
     *
     * The env files are deliberately NOT masked any more. `.env` carries the
     * tunnel token Compose interpolates on the host, and hiding it from the
     * container it configures cost more than it bought. Nothing may reintroduce
     * a value-free file mounted over a workspace path.
     */
    const base = read('compose.yaml');
    expect(base).toContain('target: /home/edge/workspace/.secrets');
    expect(base).toContain('source: workspace-secrets-mask');
    expect(base).toContain('nocopy: true');
    expect(compose).not.toContain('empty.env');
  });

  it('retains rootless keep-id and rejects privilege/network/storage shortcuts', () => {
    expect(read('compose.yaml')).toContain('userns_mode: keep-id:uid=1000,gid=1000');
    for (const pattern of [/privileged\s*:\s*true/u, /network_mode\s*:\s*host/u, /cap_add\s*:/u]) {
      expect(compose).not.toMatch(pattern);
    }

    /*
     * `tmpfs` is scoped to the workspace container rather than to the file. The
     * connector beside it is `read_only: true` and needs a writable /tmp to run
     * at all, so a blanket ban would forbid the safer of the two configurations.
     * `core` is not read-only and has a bind-mounted workspace, so a tmpfs there
     * would only be somewhere state hides from the host.
     */
    // An empty block would satisfy the negative assertion below without reading
    // anything, so prove the extraction found the service first.
    expect(service('core')).toContain('userns_mode: keep-id:uid=1000,gid=1000');
    expect(service('core')).not.toMatch(/\btmpfs\s*:/u);
    expect(read('compose.override.yaml.example')).not.toMatch(/\btmpfs\s*:/u);
  });

  it('publishes every normal and OAuth port to host loopback only', () => {
    const publications = [...compose.matchAll(/^\s+- ['"](127\.0\.0\.1:\d+:\d+)['"]/gmu)].map(
      (match) => match[1],
    );
    expect(publications.length).toBeGreaterThan(0);
    for (const publication of publications) {
      expect(publication).toMatch(/^127\.0\.0\.1:\d+:\d+$/u);
    }
  });

  it('does not bake or interpolate credentials', () => {
    expect(containerfile).not.toMatch(/^\s*(?:ARG|ENV)\s+.*(?:TOKEN|SECRET|PASSWORD|API_KEY)/mu);
    expect(containerfile).not.toMatch(
      /^\s*(?:COPY|ADD)\s+.*(?:\.secrets|\.ssh|\.gnupg|\.wrangler)/mu,
    );
    expect(read('compose.yaml')).not.toContain('CLOUDFLARE_API_TOKEN');

    /*
     * Interpolating a credential is no longer forbidden outright — the tunnel
     * connector moved into `compose.yaml`, and reading its token from the
     * gitignored `.env` is exactly how it is supposed to get one. What must stay
     * true is that this is the ONLY such interpolation, and that no compose file
     * ever assigns a credential a literal value.
     *
     * Comment lines are excluded: only real assignments can leak a credential,
     * and the comments around the tunnel token quote the withdrawn
     * `${EDGE_CLOUDFLARED_TOKEN:-${CLOUDFLARED_TOKEN:-}}` fallback in order to
     * explain why it must not come back.
     */
    const interpolated = read('compose.yaml')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('#'))
      .filter((line) => /\$\{[^}]*(?:TOKEN|SECRET|API_KEY|PASSWORD)/u.test(line));
    expect(interpolated).toEqual([
      // The host's gh identity, borrowed rather than copied: no literal, and
      // `:-` so a machine without one still resolves the configuration.
      'GH_TOKEN: ${GH_TOKEN:-}',
      // One variable, no fallback chain. Global uses this same name in its own
      // `.env`, for a different tunnel; see adr/014-edge-owned-development-tunnel.md.
      "TUNNEL_TOKEN: '${CLOUDFLARED_TOKEN:-}'",
    ]);
    for (const path of composeFiles) {
      const literals = read(path)
        .split('\n')
        .map((line) =>
          /^\s*[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD)[A-Z0-9_]*:\s*(.*)$/u.exec(line),
        )
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => match[1] as string)
        .filter((value) => !/^['"]?\$\{/u.test(value));
      expect(literals, `${path} assigns a literal credential`).toEqual([]);
    }
  });

  it('builds without Corepack', () => {
    // Node ships Corepack only below 25.0.0, so anything relying on it has an
    // expiry date. Removing it also keeps `corepack enable` from putting a
    // second pnpm on PATH ahead of the standalone install.
    expect(instructions).not.toMatch(/\bcorepack\s+(?:enable|prepare|install)\b/u);
    expect(instructions).toContain('npm rm --global corepack');
  });

  it('installs pnpm from exactly one source, on a predictable PATH', () => {
    expect(containerfile).toMatch(/get\.pnpm\.io\/install\.sh/u);
    expect(containerfile).not.toMatch(/npm\s+(?:install|i)\s+--global[^\n]*\bpnpm@/u);
    // pnpm 11 onwards puts the CLI and its `pn`/`pnpx`/`pnx` aliases in
    // PNPM_HOME/bin. Pointing PATH at PNPM_HOME itself is the v10 layout and
    // leaves no pnpm.
    expect(containerfile).toMatch(/PATH=[^\n]*\$\{?PNPM_HOME\}?\/bin|PATH=[^\n]*\/pnpm\/bin/u);
  });

  it('pins Node and pnpm identically in the Containerfile and package.json', () => {
    const { devEngines } = JSON.parse(read('package.json'));
    expect(containerfile).toContain(`ARG PNPM_VERSION=${devEngines.packageManager.version}`);
    expect(containerfile).toContain(`ARG NODE_VERSION=${devEngines.runtime.version}-trixie`);
  });

  it('declares the toolchain versions through devEngines, not the legacy field', () => {
    const rootPackage = JSON.parse(read('package.json'));
    expect(rootPackage.packageManager).toBeUndefined();
    expect(rootPackage.devEngines.packageManager.name).toBe('pnpm');
    // `download` lets pnpm enforce its own pin; `warn` keeps pnpm from
    // fetching a second Node.js runtime into the image's node_modules.
    expect(rootPackage.devEngines.packageManager.onFail).toBe('download');
    expect(rootPackage.devEngines.runtime.onFail).toBe('warn');
  });

  it('keeps TTY and stdin on the interactive core only', () => {
    expect(compose.match(/^\s+tty:\s*true$/gmu) ?? []).toHaveLength(1);
    expect(compose.match(/^\s+stdin_open:\s*true$/gmu) ?? []).toHaveLength(1);
  });

  it('does not retain dangerous editor or AI bypasses', () => {
    expect(devcontainer).not.toContain('allowDangerouslySkipPermissions');
    expect(devcontainer).not.toContain('extensions.verifySignature');
    expect(devcontainer).not.toMatch(/dangerously-skip-permissions|bypassPermissions/iu);
  });

  it('has no long-lived credential injection path left', () => {
    // Credentials are obtained inside the container through browser flows
    // (`gh auth login --web`, `scripts/wrangler-login`, `claude` /login,
    // `codex login`, `cloudflared access login`) and are never persisted.
    // The credential overlay, its Podman Secrets, and scripts/setup-secrets
    // are gone; nothing may reintroduce them.
    expect(existsSync(join(repoRoot, 'compose.credentials.yaml'))).toBe(false);
    expect(existsSync(join(repoRoot, 'scripts/setup-secrets'))).toBe(false);
    expect(compose).not.toContain('/run/secrets');
    expect(compose).not.toMatch(/^\s*secrets:/mu);

    const scripts = ['dev-start', 'wrangler-login', 'github-readonly-check', 'check-tunnel']
      .map((name) => read(`scripts/${name}`))
      .join('\n');
    expect(scripts).not.toContain('/run/secrets');
    expect(scripts).not.toContain('--credentials');
  });

  it('still proves the secret input directory cannot enter the build context', () => {
    expect(read('scripts/verify-build-context')).toContain('build-context-canary');
  });
});
