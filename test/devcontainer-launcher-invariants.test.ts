import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const launcherPath = join(repoRoot, 'scripts/devcontainer-up');
const launcher = readFileSync(launcherPath, 'utf8');

describe('Dev Container launcher', () => {
  it('serializes the CLI fallback Feature image across repositories', () => {
    expect(launcher).toContain('devcontainers-feature-content.lock');
    expect(launcher).toMatch(/flock --nonblock 9/u);
    expect(launcher).toMatch(/flock 9/u);
  });

  it('pins the rootless Podman and Compose executables', () => {
    expect(launcher).toContain('PODMAN_COMPOSE_PROVIDER=/usr/bin/podman-compose');
    expect(launcher).toContain('--docker-path /usr/bin/podman');
    expect(launcher).toContain('--docker-compose-path /usr/bin/podman-compose');
  });

  it('is executable', () => {
    expect(statSync(launcherPath).mode & 0o111).not.toBe(0);
  });
});
