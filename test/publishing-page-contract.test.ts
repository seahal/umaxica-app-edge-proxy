import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');

const AUDIENCES = ['app', 'com', 'org'] as const;
const SURFACES = ['docs', 'help', 'info', 'news'] as const;

describe('twelve-cell publishing contract', () => {
  it.each(AUDIENCES.flatMap((audience) => SURFACES.map((surface) => [audience, surface] as const)))(
    '%s/%s uses page pagination, public_id, and Rails staff management URLs',
    (audience, surface) => {
      const unit = join(repoRoot, audience, surface);
      const cell = readFileSync(join(unit, 'src/lib/publishing-cell.ts'), 'utf8');
      const index = readFileSync(join(unit, 'src/pages/[lang]/entries/index.astro'), 'utf8');
      const show = readFileSync(join(unit, 'src/pages/[lang]/entries/[public_id].astro'), 'utf8');
      const client = readFileSync(join(unit, 'src/lib/rails-entries.ts'), 'utf8');
      const api = readFileSync(join(unit, 'src/lib/publishing-api.ts'), 'utf8');

      expect(cell).toContain(`PUBLISHING_NAMESPACE = '${surface}'`);
      expect(cell).toContain(`PUBLISHING_SURFACE = '${audience}'`);

      expect(client).toContain("query.set('page', String(options.page))");
      expect(client).not.toContain('next_cursor');
      expect(client).not.toContain('has_more');
      expect(client).not.toContain('fetchAllEntries');
      expect(client).not.toContain('query.set(\'offset\'');

      expect(api).toContain('parsePublicPageQuery');
      expect(api).not.toContain('cursor');

      expect(index).toContain('parsePublicPageQuery');
      expect(index).toContain('managementIndexUrl');
      expect(index).toContain('rel="prev"');
      expect(index).toContain('rel="next"');
      expect(index).not.toContain('cursor');
      expect(index).not.toContain('cookieStore');
      expect(index).not.toContain('document.cookie');

      expect(show).toContain('managementEditUrl');
      expect(show).toContain('entry.public_id');
      expect(show).not.toContain('entry.slug');
      expect(show).not.toContain('cookieStore');
    },
  );
});
