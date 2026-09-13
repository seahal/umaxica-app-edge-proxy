/**
 * The local-override contract.
 *
 *   compose.yaml                  = the complete standard environment
 *   compose.override.yaml         = optional, gitignored, host-specific
 *   compose.override.yaml.example = tracked documentation, never required
 *
 * A fresh `git clone` plus a container engine must be enough to start the
 * development environment and to open the Dev Container, on Ubuntu and on
 * RHEL/Fedora with SELinux Enforcing, under Docker and under rootless Podman.
 * Nothing here may need a file the clone does not contain.
 *
 * These checks read files, so they need no container engine. The one that does
 * (the merge check) skips itself when none is installed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseJsonc } from '../tools/lib/wrangler-config.mjs';

const repoRoot = join(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const composeBase = read('compose.yaml');
// `core` moved here so a bare `podman compose up` does not start it.
const composeDevcontainer = read('.devcontainer/compose.yaml');
const overrideExample = read('compose.override.yaml.example');
const devcontainerSource = read('.devcontainer/devcontainer.json');
const devStart = read('scripts/dev-start');
const gitignore = read('.gitignore');

function trackedFiles(): string[] {
  const injected = process.env['EDGE_TRACKED_FILES'];
  if (injected !== undefined) {
    return injected.split('\n').filter(Boolean);
  }
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/**
 * `devcontainer.json` is JSON with comments, and the comments here carry the
 * reasoning. It is also JSONC in full: the Dev Containers CLI parses it with
 * `jsonc-parser`, so a trailing comma before a `}` is as legal as a comment.
 * `parseJsonc` is the repository's string-aware reader -- the same one
 * `wrangler.jsonc` goes through -- so the assertions describe the
 * configuration rather than the prose, and a legal edit to the file cannot
 * fail this suite for a syntax the CLI accepts.
 */
function parseDevcontainer(): { dockerComposeFile: string[] } {
  return parseJsonc(devcontainerSource) as { dockerComposeFile: string[] };
}

/** Compose text with its comment lines removed, so prose cannot satisfy a check. */
const directives = (source: string) =>
  source
    .split('\n')
    .filter((line) => !/^\s*#/u.test(line))
    .join('\n');

describe('optional local Compose override', () => {
  it('resolves the Dev Container from tracked files only', () => {
    // Invariant B, and the regression guard for the original bug: the Dev
    // Containers CLI passes each `dockerComposeFile` entry to Compose as `-f`,
    // and a missing entry fails configuration resolution outright:
    //   open .../compose.custom.yaml: no such file or directory
    // A gitignored file is therefore never a legal entry.
    const tracked = new Set(trackedFiles());
    const entries = parseDevcontainer().dockerComposeFile;
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      // Entries are relative to `devcontainer.json`, which lives in `.devcontainer/`.
      const fromRepoRoot = join('.devcontainer', entry).replaceAll('\\', '/');
      const normalised = fromRepoRoot.startsWith('.devcontainer/../')
        ? fromRepoRoot.slice('.devcontainer/../'.length)
        : fromRepoRoot;
      expect(existsSync(join(repoRoot, normalised)), `${entry} is missing`).toBe(true);
      expect(tracked.has(normalised), `${entry} is not tracked by git`).toBe(true);
    }
  });

  it('keeps nothing host-specific in the standard environment', () => {
    // Invariant C. `compose.yaml` is interpolated in full whatever service is
    // being started, so a required `${VAR:?}` anywhere in it stops a machine
    // that does not set it — including a fresh clone. And a bind whose source
    // is a host path that may not exist fails before any container starts
    // (Podman goes further and invents the missing source as a directory).
    const base = directives(composeBase);
    expect(base, 'compose.yaml has a required interpolation').not.toMatch(/\$\{[^}]+:\?/u);
    expect(base, 'compose.yaml binds a host home path').not.toContain('${HOME}');
    expect(base, 'compose.yaml forwards an ssh-agent socket').not.toContain('SSH_AUTH_SOCK');
  });

  it('carries the SELinux relabel opt-out in the standard environment', () => {
    // SELinux Enforcing (RHEL/Fedora) is a supported host, so what it needs is
    // standard configuration, not a local override a developer has to write.
    // The bind mounts here carry no `:z`/`:Z` on purpose — those relabel the
    // HOST tree — and `label=disable` is scoped to this one container and is
    // inert on hosts without SELinux, under both Docker and Podman.
    const core = /^ {2}core:\n((?: {4}.*\n|\n)*)/mu.exec(composeDevcontainer)?.[1] ?? '';
    expect(core).not.toBe('');
    expect(core).toContain('label=disable');
    // The twenty dev servers are the same image on the same bind, so they need the
    // same opt-out; they share it through the `*unit` anchor.
    expect(composeBase).toContain('label=disable');
    expect(directives(composeBase)).not.toMatch(/:\s*[zZ]\b/u);
    expect(directives(composeDevcontainer)).not.toMatch(/:\s*[zZ]\b/u);
  });

  it('never requires the override to exist', () => {
    // Invariant A/C. `scripts/dev-start` may load the override but must guard
    // it with an existence test, and must not create one: seeding a file from a
    // template is what made the old overlay mandatory in the first place.
    expect(devStart).toMatch(/if \[\[ -e compose\.override\.yaml \]\]/u);
    // A `cp` inside an `echo` is advice a developer may follow; a `cp` the
    // script runs is what made the old overlay mandatory. Only the latter is
    // forbidden, so anchor on a statement rather than a mention.
    expect(devStart, 'dev-start seeds the override').not.toMatch(
      /^\s*cp\s+compose\.override\.yaml\.example/mu,
    );
  });

  it('keeps the override out of git', () => {
    // Invariant E. Also keeps the retired name ignored so an existing local
    // copy does not surface as an untracked file mid-migration.
    expect(gitignore).toMatch(/^\/compose\.override\.yaml$/mu);
    expect(gitignore).toMatch(/^\/compose\.custom\.yaml$/mu);
  });

  it('documents an example that matches the current schema', () => {
    // Invariant F. The example is documentation, so it has to stay loadable and
    // has to talk about services that still exist; a stale example is worse
    // than none. It must also stay free of secrets and private keys.
    // Both files, because `scripts/dev-start` -- the override's main consumer --
    // loads them together, and `core` is the service the example overrides.
    const services = [composeBase, composeDevcontainer].flatMap((text) =>
      [...text.matchAll(/^ {2}([a-z0-9][\w-]*):/gmu)].map((m) => m[1]),
    );
    const exampleServices = [
      ...directives(overrideExample).matchAll(/^ {2}([a-z0-9][\w-]*):/gmu),
    ].map((m) => m[1]);
    for (const service of exampleServices) {
      expect(services, `override example names unknown service ${service}`).toContain(service);
    }
    expect(directives(overrideExample)).not.toMatch(/\$\{[^}]+:\?/u);
    expect(directives(overrideExample)).not.toMatch(/id_(?:rsa|ecdsa|ed25519)\b(?!\.pub)/u);
    expect(directives(overrideExample)).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/u);
  });

  const engine = ['docker', 'podman'].find(
    (candidate) => spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0,
  );

  it.skipIf(engine === undefined)('merges the example without conflict', () => {
    // Invariant D, and the one check that needs a real Compose implementation:
    // `security_opt` entries are APPENDED rather than replaced, so an override
    // restating `no-new-privileges:true` or `label=disable` makes Compose v2.24+
    // reject the merged file with `items at 0 and 1 are equal`. Prove the
    // shipped example merges and that neither entry got duplicated.
    const scratch = mkdtempSync(join(tmpdir(), 'edge-override-'));
    try {
      const overridePath = join(scratch, 'compose.override.yaml');
      copyFileSync(join(repoRoot, 'compose.override.yaml.example'), overridePath);
      const merged = spawnSync(
        engine as string,
        ['compose', '-f', 'compose.yaml', '-f', overridePath, 'config'],
        { cwd: repoRoot, encoding: 'utf8' },
      );
      expect(merged.stderr).not.toMatch(/items at \d+ and \d+ are equal/u);
      expect(merged.status, merged.stderr).toBe(0);
      expect(merged.stdout.match(/label=disable/gu)).toHaveLength(1);
      expect(merged.stdout.match(/no-new-privileges:true/gu)?.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
