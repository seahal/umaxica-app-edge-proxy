/**
 * Static guardrails for the Edge-owned Tunnel connector and secret boundary.
 * Edge and Global use different Tunnel IDs and tokens and share no Podman network.
 * Everything reads files directly, so the checks require no container engine.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const composeBase = read('compose.yaml');
const composeDevcontainer = read('.devcontainer/compose.yaml');
// `compose.override.yaml` is the OPTIONAL developer-local override: gitignored,
// absent on a fresh clone, never created automatically, and carrying arbitrary
// host-specific edits where it exists. Only the tracked example can be asserted
// on, and it is documentation rather than a required input.
const composeOverrideExample = read('compose.override.yaml.example');
const devcontainer = read('.devcontainer/devcontainer.json');

/**
 * Every compose file that can define a service, checked as one set.
 *
 * Enumerated rather than globbed so that adding a compose file is a deliberate
 * act: a new override that nobody adds here would sit outside these assertions
 * while looking covered. The repository is meant to have exactly these two —
 * the complete standard environment, and the documented example override — so
 * the count is asserted, not just the names.
 */
const composeFiles = [
  ['compose.yaml', composeBase],
  ['compose.override.yaml.example', composeOverrideExample],
] as const;

/**
 * Source files worth scanning for leaked secrets.
 *
 * Enumerated via `git ls-files` rather than a directory walk: it is exactly the
 * set of files that can reach another machine, and it skips build output,
 * node_modules, and untracked tool caches for free.
 */
function collectSourceFiles(): string[] {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.jsonc'];

  return (
    trackedFiles()
      .filter((path) => extensions.some((extension) => path.endsWith(extension)))
      .map((path) => join(repoRoot, path))
      // `git ls-files` still lists files deleted in the working tree but not yet
      // staged. They cannot reach another machine, so skip them.
      .filter((path) => existsSync(path))
  );
}

function trackedFiles(): string[] {
  const injected = process.env['EDGE_TRACKED_FILES'];
  if (injected !== undefined) {
    return injected.split('\n').filter(Boolean);
  }
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

describe('Edge-owned tunnel connector', () => {
  it('pins the supported cloudflared release in the shared file only', () => {
    // The connector is shared infrastructure, so it is defined once, centrally.
    // Only its token is per-developer, and that comes from the gitignored `.env`
    // rather than from the developer-local overlay.
    expect(composeBase).toContain('docker.io/cloudflare/cloudflared:2026.8.2');
    expect(composeOverrideExample).not.toContain('cloudflared');
  });

  it('keeps exactly three compose files, each with a distinct role', () => {
    // The assertions above are only as complete as this list: the shared
    // services and the per-unit dev servers are in `compose.yaml`, `core` is in
    // `.devcontainer/compose.yaml`, and everything machine-specific goes in the
    // optional `compose.override.yaml` that `compose.override.yaml.example`
    // documents. A new file must be added here to be covered, so make the
    // omission fail.
    for (const [name] of composeFiles) {
      expect(existsSync(join(repoRoot, name)), `${name} is asserted on but missing`).toBe(true);
    }

    const trackedCompose = trackedFiles()
      .filter((path) => /(?:^|\/)compose\..*ya?ml(?:\.example)?$/u.test(path))
      .sort();
    expect(trackedCompose).toEqual([
      '.devcontainer/compose.yaml',
      'compose.override.yaml.example',
      'compose.yaml',
    ]);

    // Invariant E: the override itself must stay untracked. Committing it would
    // put one developer's host in everyone's checkout, and it would silently
    // outrank the example these invariants read. The retired `compose.custom.*`
    // names must not come back either.
    expect(trackedCompose).not.toContain('compose.override.yaml');
    expect(trackedCompose).not.toContain('compose.custom.yaml');
    expect(trackedCompose).not.toContain('compose.custom.yaml.example');
  });

  it('defines one hardened connector without a cross-project network', () => {
    // `core` is the only service in the Dev Container's file, and the connector is
    // the only service in `compose.yaml` without a profile -- the twenty dev
    // servers all sit behind `profiles: [app]`, so a bare `podman compose up`
    // starts the connector and nothing else.
    const namesIn = (text: string): string[] => {
      const block = /^services:\n((?: .*\n|\n)*)/mu.exec(text)?.[1] ?? '';
      return [...block.matchAll(/^ {2}([a-z0-9][\w-]*):/gmu)].map((match) => match[1] as string);
    };
    expect(namesIn(composeDevcontainer)).toEqual(['core']);

    const alwaysStarted = namesIn(composeBase).filter((name) => {
      const body =
        new RegExp(`^ {2}${name}:\n((?: {4}.*\n|\n)*)`, 'mu').exec(composeBase)?.[1] ?? '';
      return !body.includes('<<: *unit') && !body.includes('profiles:');
    });
    expect(alwaysStarted).toEqual(['cloudflare-tunnel']);

    const connector = /^ {2}cloudflare-tunnel:\n((?: {4}.*\n|\n)*)/mu.exec(composeBase)?.[1] ?? '';
    expect(connector).not.toBe('');
    expect(connector).not.toContain('umaxica-edge-tunnel');
    expect(connector).not.toContain('host.docker.internal');
    expect(connector).toContain('read_only: true');
    expect(connector).toContain('no-new-privileges:true');
    expect(connector).toContain('cap_drop:');
    expect(connector).toContain('restart: on-failure:3');
  });

  it('starts the connector with the standard devcontainer lifecycle', () => {
    // Invariant B: exactly two compose files, both tracked, so the Dev
    // Container configuration resolves on a fresh clone with no local file
    // creation. `core` is defined in the second one, which is what keeps it out
    // of a bare `podman compose up`. The Dev Containers CLI passes every entry to Compose as `-f`,
    // so any entry that a clone does not contain fails the whole `up` with a
    // bare `no such file or directory` — which is how Codespaces used to break
    // on the retired developer-local overlay.
    //
    // The same `-f` means Compose does not auto-discover `compose.override.yaml`
    // here; the optional override reaches only `scripts/dev-start` and a bare
    // `docker compose`. `compose-local-override-invariants.test.ts` proves every
    // listed entry is a tracked file.
    expect(devcontainer).toContain('"dockerComposeFile": ["../compose.yaml", "./compose.yaml"]');
    // Compose takes the project name from the last file that sets one, so a
    // divergent `name:` in an override forks the project away from
    // `compose.yaml` and `scripts/dev-start` — a second volume set, and a port
    // clash with the containers `--remove-existing-container` then fails to
    // find. The example shows the right value.
    expect(composeOverrideExample).toMatch(/^name: umaxica-apps-edge$/mu);
    expect(devcontainer).toContain('"runServices": ["core", "cloudflare-tunnel"]');
  });

  /*
   * The tunnel token is exactly one variable with no fallback chain. Global uses
   * the same variable name in its own `.env`, which is fine — each Compose
   * project reads the file beside its own compose file, so one name holds two
   * different tunnels. What broke on 2026-09-04 was the fallback
   * `${EDGE_CLOUDFLARED_TOKEN:-${CLOUDFLARED_TOKEN:-}}`: on a machine carrying
   * only Global's value it silently made this connector a replica of Global's
   * tunnel from a network with no route to Rails — indistinguishable to
   * Cloudflare from a healthy replica, and broken for both repositories. Any
   * `:-` chain between two credential variables can do that again, so none may
   * appear here. See ADR 014.
   */
  it('reads the tunnel token from exactly one variable, with no fallback chain', () => {
    expect(composeBase).toMatch(/TUNNEL_TOKEN: ['"]\$\{CLOUDFLARED_TOKEN:-\}['"]/u);
    // A second `${` inside the TUNNEL_TOKEN value is a fallback chain.
    expect(composeBase).not.toMatch(/TUNNEL_TOKEN:[^\n]*\$\{[^}]*\$\{/u);
  });

  /*
   * The token may still not carry a `:?` guard. Compose interpolates the whole
   * file whichever services are named, so now that the connector shares
   * `compose.yaml` with `core`, a required variable would stop `podman compose up
   * core` on every machine that never runs a tunnel. `scripts/dev-start --tunnel`
   * is where the requirement is enforced instead, and it has to look in `.env` as
   * well as in the shell, because compose reads that file and bash does not.
   */
  it('refuses to start a tunnel without a token', () => {
    expect(composeBase).not.toMatch(/CLOUDFLARED_TOKEN:\?/u);

    const devStart = read('scripts/dev-start');
    expect(devStart).toMatch(/--tunnel requires CLOUDFLARED_TOKEN/u);
    expect(devStart).toContain("sed -n 's/^CLOUDFLARED_TOKEN=//p' .env");
  });

  /*
   * Sharing the variable name with Global means the name itself can no longer
   * catch a copied value, so `dev-start --tunnel` decodes the tunnel UUID from
   * the token and compares it against the connectors already running on this
   * host. That comparison is now the only thing standing between a pasted `.env`
   * and a repeat of 2026-09-04.
   */
  it('refuses to add a second connector to a tunnel that already has one', () => {
    const devStart = read('scripts/dev-start');
    expect(devStart).toMatch(/tunnel_uuid_of\(\)/u);
    expect(devStart).toMatch(/already has a connector on this host/u);
    // Every cloudflared container on the host counts, not only this compose
    // project's own.
    expect(devStart).toMatch(
      /podman ps --format '\{\{\.Names\}\}'[^\n]*\n?[^\n]*grep -i cloudflare/u,
    );
  });
});

describe('secret hygiene', () => {
  it('keeps .env untracked and ignored', () => {
    const tracked = trackedFiles();

    expect(tracked).not.toContain('.env');
    expect(tracked.filter((path) => path.startsWith('.env') && path !== '.env.example')).toEqual(
      [],
    );
    expect(read('.gitignore')).toMatch(/^\.env$/mu);
  });

  it('ships value-free .env examples everywhere', () => {
    /*
     * Name-agnostic on purpose: rather than listing the variables that happen to
     * exist today, assert that no tracked `.env.example` assigns a value to
     * anything. A new secret added to an example is then caught without anyone
     * remembering to extend this test.
     *
     * Local Rails connectivity needs no environment credential or public
     * fallback origin, so every tracked example must remain value-free.
     */
    const allowedWithValue = new Set<string>();
    const offenders: string[] = [];

    for (const path of trackedFiles().filter((file) => file.endsWith('.env.example'))) {
      for (const line of read(path).split('\n')) {
        const match = /^([A-Z0-9_]+)=(.+)$/u.exec(line.trim());
        if (match && !allowedWithValue.has(match[1] as string)) {
          offenders.push(`${path}: ${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never exposes a credential through a client-visible variable prefix', () => {
    // NEXT_PUBLIC_* and VITE_* are inlined into the browser bundle at build
    // time. A name matching /token|secret|credential/ under those prefixes is
    // a leak regardless of the value.
    const forbidden =
      /\b(?:NEXT_PUBLIC|VITE)_[A-Z0-9_]*(?:TOKEN|SECRET|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_]*\b/u;
    const offenders: string[] = [];

    for (const file of collectSourceFiles()) {
      if (relative(repoRoot, file) === relative(repoRoot, import.meta.filename)) continue;
      if (forbidden.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(repoRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never relays an inbound caller credential onward to Rails', () => {
    /*
     * The direction of trust. A credential arriving on an inbound request — a
     * browser session cookie, an `Authorization` header, an Access token
     * belonging to the end user — must never be forwarded to Rails. Every copy
     * strips those before dispatch, and applies its own transport credentials
     * only afterwards, so `init.headers` cannot smuggle one through.
     *
     * `test/rails-connection-invariants.test.ts` covers the other half: no
     * credential may be committed to source or to `wrangler.jsonc`.
     */
    const clients = ['app', 'com', 'org'].flatMap((tld) =>
      ['core', 'docs', 'news', 'help', 'info'].map(
        (frame) => `${tld}/${frame}/src/lib/rails-client.ts`,
      ),
    );

    for (const client of clients) {
      const source = read(client);

      /*
       * Server-only, so nothing here can be bundled for the browser — and it has
       * to be the marker the unit's own bundler enforces. The `server-only`
       * package makes a Next build fail; `@tanstack/react-start/server-only` is
       * the equivalent for a Vite frame, denied in the client environment by the
       * Start plugin. Either satisfies the invariant; neither is optional.
       */
      const isAstro = existsSync(
        join(repoRoot, client.replace(/src\/lib\/rails-client\.ts$/u, 'astro.config.mjs')),
      );
      if (isAstro) {
        expect(source, `${client} must not import a Start/Next server-only marker`).not.toMatch(
          /import '(?:server-only|@tanstack\/react-start\/server-only)'/u,
        );
      } else {
        expect(source, `${client} must be server-only`).toMatch(
          /import '(?:server-only|@tanstack\/react-start\/server-only)'/u,
        );
      }

      for (const header of [
        'cookie',
        'authorization',
        'cf-access-client-id',
        'cf-access-client-secret',
      ]) {
        expect(source, `${client} must strip ${header}`).toContain(`'${header}'`);
      }

      const stripIndex = source.indexOf('FORBIDDEN_REQUEST_HEADERS) {');
      expect(stripIndex, `${client} lost the header strip`).toBeGreaterThan(-1);

      if (!isAstro) {
        // The Cores reach Rails over the public internet with no transport
        // credential at all (adr/018-core-rails-direct-internet.md), so there is
        // nothing to apply after the strip — and nothing may be added back.
        expect(source, `${client} must apply no transport credentials`).not.toContain(
          'authHeaders',
        );
        continue;
      }

      // The strip must precede the transport's own headers, otherwise a caller
      // could override the service token — or keep their own.
      const applyIndex = source.indexOf('Object.entries(authHeaders)');
      expect(applyIndex, `${client} lost the auth application`).toBeGreaterThan(-1);
      expect(applyIndex, `${client} applies credentials before stripping`).toBeGreaterThan(
        stripIndex,
      );
    }
  });
});

describe('environment separation', () => {
  it('keeps the application environment at development, never aliased to staging', () => {
    // If staging returns, it arrives as new wrangler env blocks and new
    // Cloudflare config — not as a branch in application code.
    const offenders: string[] = [];

    for (const file of collectSourceFiles()) {
      const path = relative(repoRoot, file);
      if (path.includes('test/') || path.endsWith('.test.ts') || path.endsWith('.test.tsx'))
        continue;
      if (path === 'plans' || path.startsWith('plans/')) continue;
      if (
        /(?:ENV|environment|NODE_ENV)\b[^\n]{0,40}===?\s*['"]staging['"]/u.test(
          readFileSync(file, 'utf8'),
        )
      ) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
    expect(composeBase).toMatch(/CLOUDFLARE_ENV:\s*development/u);
    expect(composeBase).not.toMatch(/CLOUDFLARE_ENV:\s*staging/u);
  });
});
