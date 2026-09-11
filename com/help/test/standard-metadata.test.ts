import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CANONICAL_ORIGIN } from '../src/lib/canonical';
import { CANONICAL_ORIGINS, PUBLISHING_AUDIENCE } from '../src/lib/publishing-cell';
import { siteCopy } from '../src/lib/site-copy';
import { handlers } from './utils/routes';

const unitRoot = resolve(import.meta.dirname, '..');

/*
 * robots.txt, sitemap.xml and the manifest are ordinary server routes, so each
 * is asserted on the response — including the `Content-Type` each states
 * explicitly because nothing else infers it.
 */
describe('standard metadata', () => {
  it('uses the jp origin when no region is built in', () => {
    expect(CANONICAL_ORIGIN).toBe(CANONICAL_ORIGINS.jp);
  });

  it('keeps robots and sitemap on the canonical host, with ja/en alternates', async () => {
    const robots = await handlers.robots();
    expect(robots.headers.get('content-type')).toContain('text/plain');
    const robotsBody = await robots.text();
    expect(robotsBody).toContain('User-Agent: *');
    expect(robotsBody).toContain('Allow: /');
    expect(robotsBody).toContain(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`);

    const sitemap = await handlers.sitemap();
    expect(sitemap.headers.get('content-type')).toContain('xml');
    const body = await sitemap.text();
    for (const path of ['/ja/', '/en/', '/ja/entries/', '/en/search/', '/ja/about/']) {
      expect(body).toContain(`<loc>${CANONICAL_ORIGIN}${path}</loc>`);
    }
    expect(body).toContain(`hreflang="en" href="${CANONICAL_ORIGIN}/en/entries/"`);
    expect(body).not.toContain('/page/1/');
    expect(body).not.toContain('localhost');
  });

  it('publishes the manifest for this cell', async () => {
    const manifest = await handlers.manifest();
    expect(manifest.headers.get('content-type')).toContain('application/manifest+json');
    await expect(manifest.json()).resolves.toMatchObject({
      name: `UMAXICA ${siteCopy('ja').product} (${PUBLISHING_AUDIENCE})`,
      start_url: '/ja/',
      display: 'standalone',
      icons: [expect.objectContaining({ src: '/favicon.ico' })],
    });
  });

  it('negotiates / onto a locale with an uncacheable 302', async () => {
    const ja = await handlers.root(
      new Request('https://example.test/', { headers: { 'accept-language': 'ja,en;q=0.8' } }),
    );
    expect(ja.status).toBe(302);
    expect(ja.headers.get('location')).toBe('https://example.test/ja/');
    expect(ja.headers.get('vary')).toBe('Accept-Language');
    expect(ja.headers.get('cache-control')).toBe('no-store');

    const en = await handlers.root(
      new Request('https://example.test/', { headers: { 'accept-language': 'en-US' } }),
    );
    expect(en.headers.get('location')).toBe('https://example.test/en/');
  });

  it('ships the browser assets the documents reference', () => {
    expect(statSync(resolve(unitRoot, 'public/favicon.ico')).size).toBeGreaterThan(0);
    const worker = readFileSync(resolve(unitRoot, 'public/service-worker.js'), 'utf8');
    expect(worker).toContain("event.request.mode !== 'navigate'");
    expect(worker).toContain('fetch(event.request).catch');
    expect(worker).toContain("const OFFLINE_URL = '/offline'");
  });
});
