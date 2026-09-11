import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * The twelve public Publishing cells, checked as one matrix
 * (adr/019-public-content-surfaces-tanstack-start.md).
 *
 *              app   com   org
 *   info        ✓     ✓     ✓
 *   docs        ✓     ✓     ✓
 *   news        ✓     ✓     ✓
 *   help        ✓     ✓     ✓
 *
 * One implementation, twelve explicit cells: every unit declares its cell in
 * `src/lib/publishing-cell.ts` and nowhere else, and every other file under
 * `src/`, `test/` and `e2e/` is byte-identical across the twelve. Each unit's
 * own suite then runs the same contract against its own cell.
 */
const repoRoot = join(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const AUDIENCES = ['app', 'com', 'org'] as const;
const SURFACES = ['info', 'docs', 'news', 'help'] as const;
const CELLS = AUDIENCES.flatMap((audience) =>
  SURFACES.map((surface) => ({ audience, surface, unit: `${audience}/${surface}` })),
);

const CELL_FILE = 'src/lib/publishing-cell.ts';

function trackedFiles(): string[] {
  const injected = process.env['EDGE_TRACKED_FILES'];
  const listing =
    injected ?? execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' });
  return listing.split('\n').filter(Boolean);
}

/** Every file of `unit` under the shared directories, relative to the unit. */
function sharedFiles(unit: string): string[] {
  return trackedFiles()
    .filter((file) => /^(?:src|test|e2e)\//u.test(file.slice(unit.length + 1)))
    .filter((file) => file.startsWith(`${unit}/`))
    .filter((file) => existsSync(join(repoRoot, file)))
    .map((file) => file.slice(unit.length + 1))
    .filter((file) => file !== CELL_FILE)
    .sort();
}

describe('twelve-cell publishing matrix', () => {
  it('has exactly twelve cells, each a TanStack Start unit with no Astro left', () => {
    expect(CELLS).toHaveLength(12);
    for (const { unit } of CELLS) {
      expect(existsSync(join(repoRoot, unit, 'astro.config.mjs')), unit).toBe(false);
      expect(existsSync(join(repoRoot, unit, 'src/routes/__root.tsx')), unit).toBe(true);
      const pkg = JSON.parse(read(`${unit}/package.json`)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      expect(deps, unit).toContain('@tanstack/react-start');
      expect(deps.filter((name) => name.includes('astro')), unit).toEqual([]);
    }
  });

  it.each(CELLS)('$unit declares its own cell statically', ({ audience, surface, unit }) => {
    const cell = read(`${unit}/${CELL_FILE}`);
    expect(cell).toContain(`PUBLISHING_SURFACE: PublishingSurface = '${surface}';`);
    expect(cell).toContain(`PUBLISHING_AUDIENCE: PublishingAudience = '${audience}';`);
    expect(cell).toContain(`BRAND_TITLE = 'UMAXICA (${audience.toUpperCase()})';`);
    expect(cell).toContain(`jp: 'https://${surface}-jp.umaxica.${audience}'`);
    expect(cell).toContain(`us: 'https://${surface}-us.umaxica.${audience}'`);
    expect(cell).toContain(`PRIVATE_RAILS_ORIGIN = 'http://${surface}.${audience}.localhost:3000';`);
  });

  it('keeps every other shared file byte-identical across the twelve', () => {
    const reference = sharedFiles('app/docs');
    expect(reference.length).toBeGreaterThan(50);
    for (const { unit } of CELLS) {
      expect(sharedFiles(unit), `${unit} file set`).toEqual(reference);
      for (const file of reference) {
        expect(read(`${unit}/${file}`), `${unit}/${file}`).toBe(read(`app/docs/${file}`));
      }
    }
  });

  it.each(CELLS)('$unit serves the whole public route contract', ({ unit }) => {
    for (const route of [
      '$lang.tsx',
      '$lang.index.tsx',
      '$lang.entries.index.tsx',
      '$lang.entries.page.$page.tsx',
      '$lang.entries.$publicId.tsx',
      '$lang.search.tsx',
    ]) {
      expect(existsSync(join(repoRoot, unit, 'src/routes', route)), `${unit} ${route}`).toBe(true);
    }
  });

  it.each(CELLS)('$unit keeps the browser-facing staff origin separate from the VPC hop', ({ unit }) => {
    const wrangler = read(`${unit}/wrangler.jsonc`);
    const origins = [...wrangler.matchAll(/"RAILS_STAFF_BASE_ORIGIN": "([^"]+)"/gu)].map((m) => m[1]);
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      expect(origin).toMatch(/^https:\/\//u);
      expect(origin).not.toMatch(/\.localhost/u);
    }
  });
});

describe('Publishing contract, asserted on the one shared implementation', () => {
  const routes = (file: string) => read(`app/docs/src/routes/${file}`);

  it('uses page pagination and public_id, never a cursor, offset or slug lookup', () => {
    const entries = read('app/docs/src/lib/rails-entries.ts');
    expect(entries).toContain("query.set('page', String(options.page))");
    for (const banned of ['next_cursor', 'has_more', 'fetchAllEntries', "query.set('offset'"]) {
      expect(entries).not.toContain(banned);
    }
    expect(routes('$lang.entries.$publicId.tsx')).toContain('params.publicId');
    expect(routes('$lang.entries.$publicId.tsx')).not.toContain('slug');
  });

  it('confines the public cache policy to the individual entry route', () => {
    const users = trackedFiles().filter(
      (file) =>
        file.startsWith('app/docs/src/') &&
        existsSync(join(repoRoot, file)) &&
        read(file).includes('ENTRY_CACHE_CONTROL'),
    );
    expect(users.sort()).toEqual([
      'app/docs/src/lib/cache-policy.ts',
      'app/docs/src/routes/$lang.entries.$publicId.tsx',
    ]);
  });

  it('reaches Rails from server-only functions, never a browser-callable server function', () => {
    const loaders = read('app/docs/src/lib/publishing-loaders.ts');
    expect(loaders).toContain('createServerOnlyFn');
    const sources = trackedFiles().filter(
      (file) => file.startsWith('app/docs/src/') && existsSync(join(repoRoot, file)),
    );
    for (const file of sources) {
      expect(read(file), file).not.toMatch(/\bcreateServerFn\b/u);
      expect(read(file), file).not.toContain('cookieStore');
      expect(read(file), file).not.toContain('document.cookie');
    }
  });

  it('keeps management links unconditional and search behind the SearchSource seam', () => {
    const collection = read('app/docs/src/components/entry-collection.tsx');
    const entry = routes('$lang.entries.$publicId.tsx');
    expect(collection).toContain('view.manageHref');
    expect(entry).toContain('editHref');
    expect(routes('$lang.search.tsx')).not.toContain('search-fixtures');
    expect(routes('$lang.search.tsx')).not.toContain('fixture-search-source');
  });
});
