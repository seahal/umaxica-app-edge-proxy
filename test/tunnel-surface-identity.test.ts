/**
 * No surface carries `/health.json` or `/health.html` as a health document.
 * Apex, cores and the twelve public content cells answer liveness on `/health`
 * (text/plain). Those two paths are 404 HTML.
 *
 * A leftover `health.json.ts` on any content frame would reintroduce a second
 * health shape that the rest of the fleet does not have.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');

const APEX_UNITS = ['app/apex', 'com/apex', 'org/apex', 'net/apex', 'dev/apex'] as const;

const CONTENT_FRAMES = [
  'app/docs',
  'app/help',
  'app/info',
  'app/news',
  'com/docs',
  'com/help',
  'com/info',
  'com/news',
  'org/docs',
  'org/help',
  'org/info',
  'org/news',
] as const;

describe('apex health contract', () => {
  /*
   * The forbidden shapes are the ROOT-level `/health.json` and `/health.html`
   * that ADR 009 keeps off the public FQDN — Rails serves those on its own
   * origin and they must not be republished here.
   *
   * Matched as quoted path literals, not as bare substrings. The bare form said
   * `not.toContain('/health.json')`, which `'/api/v0/health.json'` satisfies as
   * a substring, so this guard started failing the moment ADR 017 added the Edge
   * self-health document — reporting a violation of a rule that document does
   * not break. The quote is what pins the assertion to a whole path.
   */
  it.each(APEX_UNITS)('%s does not register /health.json or /health.html', (workspace) => {
    const source = readFileSync(join(repoRoot, workspace, 'src/create-apex-app.ts'), 'utf8');
    expect(source).not.toContain("'/health.json'");
    expect(source).not.toContain("'/health.html'");
    expect(source).not.toContain('renderHealthJson');
    expect(source).not.toContain('renderHealthPage');
    expect(source).toContain("app.get('/health'");
    // The self-health document ADR 017 does mandate, at its own path.
    expect(source).toContain("app.get('/api/v0/health.json'");
  });
});

describe('content-frame health contract', () => {
  it.each(CONTENT_FRAMES)('%s has no /health.json route', (workspace) => {
    expect(existsSync(join(repoRoot, workspace, 'src/routes/health[.]json.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, workspace, 'src/routes/health[.]json.ts'))).toBe(false);
    expect(existsSync(join(repoRoot, workspace, 'src/app/health.json/route.ts'))).toBe(false);
  });

  it.each(CONTENT_FRAMES)('%s exposes /health', (workspace) => {
    expect(existsSync(join(repoRoot, workspace, 'src/routes/health.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, workspace, 'src/routes/health.startups.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, workspace, 'src/routes/health.livenesses.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, workspace, 'src/routes/health.readinesses.ts'))).toBe(true);
  });
});
