/**
 * Static guardrails for Edge deployment revision:
 * GET /revision (text/plain) and GET /api/v0/revision.json.
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

describe('Edge revision representations', () => {
  it.each(APEX)('$0 registers both revision representations on the Hono app', (workspace) => {
    const source = code(`${workspace}/src/create-apex-app.ts`);
    expect(source).toContain("app.get('/revision'");
    expect(source).toContain("app.get('/api/v0/revision.json'");
    expect(source).toContain('c.text');
    expect(source).toContain('c.json(versionMetadata(c)');
    expect(source).toContain('CF_VERSION_METADATA');
    expect(source).toContain("`${id ?? 'unknown'}\\n`");
  });

  it.each(CORES)('$0 owns TanStack Server Routes for both representations', (workspace) => {
    const textFile = `${workspace}/src/routes/revision.ts`;
    const jsonFile = `${workspace}/src/routes/api.v0.revision[.]json.ts`;
    expect(existsSync(join(repoRoot, textFile)), textFile).toBe(true);
    expect(existsSync(join(repoRoot, jsonFile)), jsonFile).toBe(true);
    const text = code(textFile);
    const json = code(jsonFile);
    expect(text).toContain("createFileRoute('/revision')");
    expect(text).toContain('revisionTextResponse');
    expect(text).not.toContain('Response.json');
    expect(json).toContain("createFileRoute('/api/v0/revision.json')");
    expect(json).toContain('revisionJsonResponse');
    expect(json).not.toContain('text/plain');
  });

  it.each(SATELLITES)('$0 owns TanStack Server Routes for both representations', (workspace) => {
    const textFile = `${workspace}/src/routes/revision.ts`;
    const jsonFile = `${workspace}/src/routes/api.v0.revision[.]json.ts`;
    expect(existsSync(join(repoRoot, textFile)), textFile).toBe(true);
    expect(existsSync(join(repoRoot, jsonFile)), jsonFile).toBe(true);
    const text = code(textFile);
    const json = code(jsonFile);
    expect(text).toContain("createFileRoute('/revision')");
    expect(text).toContain('revisionTextResponse');
    expect(text).not.toContain('application/json');
    expect(json).toContain("createFileRoute('/api/v0/revision.json')");
    expect(json).toContain('revisionJsonResponse');
    expect(json).not.toContain('text/plain');
  });

  it.each([...APEX, ...CORES, ...SATELLITES])(
    '$0 ships the Hurl JSON contract and Playwright text contract',
    (workspace) => {
      const hurl = `${workspace}/api/revision-api.hurl`;
      const e2e = `${workspace}/e2e/revision.spec.ts`;
      expect(existsSync(join(repoRoot, hurl)), hurl).toBe(true);
      expect(existsSync(join(repoRoot, e2e)), e2e).toBe(true);
      const source = read(hurl);
      expect(source).toContain('GET {{base}}/api/v0/revision.json');
      expect(source).toContain('header "content-type" contains "application/json"');
      expect(source).toContain('header "content-type" not contains "text/plain"');
      expect(source).toContain('header "content-type" not contains "text/html"');
      expect(source).toContain('jsonpath "$.*" count == 3');
      expect(read(e2e)).toContain('toMatch(/^text\\/plain\\b/u)');
      expect(read(e2e)).toContain('JSON.parse(body)');
    },
  );

  it('keeps Hurl revision API contracts byte-identical across all twenty units', () => {
    const digests = new Set(
      [...APEX, ...CORES, ...SATELLITES].map((workspace) => read(`${workspace}/api/revision-api.hurl`)),
    );
    expect(digests.size).toBe(1);
  });

  it('keeps Playwright revision contracts byte-identical across all twenty units', () => {
    const digests = new Set(
      [...APEX, ...CORES, ...SATELLITES].map((workspace) => read(`${workspace}/e2e/revision.spec.ts`)),
    );
    expect(digests.size).toBe(1);
  });

  it('keeps public content cell revision helpers and routes byte-identical', () => {
    for (const file of [
      'src/lib/version-metadata.ts',
      'src/routes/api.v0.revision[.]json.ts',
      'src/routes/revision.ts',
    ]) {
      expect(new Set(SATELLITES.map((workspace) => read(`${workspace}/${file}`))).size, file).toBe(1);
    }
  });

  it('keeps TanStack revision helpers and JSON routes byte-identical', () => {
    expect(
      new Set(CORES.map((workspace) => read(`${workspace}/src/lib/version-metadata.ts`))).size,
    ).toBe(1);
    expect(
      new Set(CORES.map((workspace) => read(`${workspace}/src/routes/api.v0.revision[.]json.ts`)))
        .size,
    ).toBe(1);
  });

});
