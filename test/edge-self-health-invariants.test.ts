/**
 * Static guardrails for Edge self-health: GET /api/v0/health.json.
 *
 * Complementary to Hurl. These assertions exist so a copy can drift into
 * Rails, prerender, or a different path without waiting for an HTTP suite.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');
const code = (relativePath: string) =>
  read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');

const APEX = ['app/apex', 'com/apex', 'org/apex', 'net/apex', 'dev/apex'] as const;
const CORES = ['app/core', 'com/core', 'org/core'] as const;
const SATELLITES = (['app', 'com', 'org'] as const).flatMap((brand) =>
  (['docs', 'help', 'info', 'news'] as const).map((frame) => `${brand}/${frame}`),
);

describe('Edge self-health API layout', () => {
  it.each(APEX)('$0 registers GET /api/v0/health.json on the Hono app', (workspace) => {
    const source = code(`${workspace}/src/create-apex-app.ts`);
    expect(source).toContain("app.get('/api/v0/health.json'");
    expect(source).toContain('renderHealthApi');
    expect(source).not.toContain('checkRailsHealth');
    expect(source).not.toContain('getRailsClient');
  });

  it.each(CORES)('$0 owns a TanStack Server Route for the literal JSON path', (workspace) => {
    const file = `${workspace}/src/routes/api.v0.health[.]json.ts`;
    expect(existsSync(join(repoRoot, file)), file).toBe(true);
    const source = code(file);
    expect(source).toContain("createFileRoute('/api/v0/health.json')");
    expect(source).toContain('renderHealthApi');
    expect(source).not.toContain('checkRailsHealth');
    expect(source).not.toContain('getRailsClient');
    expect(source).not.toContain('checkRailsLiveness');
  });

  it.each(SATELLITES)('$0 owns a TanStack Server Route for the literal JSON path', (workspace) => {
    const file = `${workspace}/src/routes/api.v0.health[.]json.ts`;
    expect(existsSync(join(repoRoot, file)), file).toBe(true);
    const source = code(file);
    expect(source).toContain("createFileRoute('/api/v0/health.json')");
    expect(source).toContain('renderHealthApi');
    expect(source).not.toContain('checkRailsHealth');
    expect(source).not.toContain('getRailsClient');
    expect(source).not.toContain('publishing');
  });

  it.each([...APEX, ...CORES, ...SATELLITES])('$0 ships the Hurl contract', (workspace) => {
    const file = `${workspace}/api/health-api.hurl`;
    expect(existsSync(join(repoRoot, file)), file).toBe(true);
    const source = read(file);
    expect(source).toContain('GET {{base}}/api/v0/health.json');
    expect(source).toContain('header "cache-control" contains "no-store"');
    expect(source).toContain('jsonpath "$.rails" not exists');
    expect(source).toContain('jsonpath "$.revision" not exists');
  });

  it('keeps Hurl contracts byte-identical across all twenty units', () => {
    const digests = new Set(
      [...APEX, ...CORES, ...SATELLITES].map((workspace) => read(`${workspace}/api/health-api.hurl`)),
    );
    expect(digests.size).toBe(1);
  });

  it('keeps public content cell self-health routes byte-identical', () => {
    const digests = new Set(
      SATELLITES.map((workspace) => read(`${workspace}/src/routes/api.v0.health[.]json.ts`)),
    );
    expect(digests.size).toBe(1);
  });

  it('keeps TanStack self-health routes byte-identical', () => {
    const digests = new Set(
      CORES.map((workspace) => read(`${workspace}/src/routes/api.v0.health[.]json.ts`)),
    );
    expect(digests.size).toBe(1);
  });


  it.each(CORES)('$0 dispatch keeps self-health on Edge, not Rails', (workspace) => {
    const source = code(`${workspace}/src/lib/core-dispatch.ts`);
    expect(source).toContain("const EDGE_SELF_HEALTH_API = '/api/v0/health.json'");
    expect(source).toContain("const EDGE_REVISION_API = '/api/v0/revision.json'");
    expect(source).toContain('pathname === EDGE_SELF_HEALTH_API || pathname === EDGE_REVISION_API');
  });
});
