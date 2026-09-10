import type { APIRoute } from 'astro';

import { LOCALES } from '../i18n';
import { CANONICAL_ORIGIN } from '../lib/canonical';

/*
 * Ported from `src/routes/sitemap[.]xml.ts` and widened per plan §6b: every
 * public page in every language, each `<url>` carrying `xhtml:link` alternates
 * so a crawler sees the ja/en pair. The TanStack unit listed only the home page
 * in one language.
 */
export const prerender = true;

const PAGES = [
  { path: '/', changefreq: 'weekly', priority: '0.5' },
  { path: '/entries', changefreq: 'weekly', priority: '0.6' },
  { path: '/about', changefreq: 'monthly', priority: '0.3' },
];

function loc(lang: string, path: string): string {
  const normalized = path === '/' ? '' : path.replace(/\/$/u, '');
  return `${CANONICAL_ORIGIN}/${lang}${normalized}/`;
}

export const GET: APIRoute = () => {
  const urls = PAGES.flatMap((page) =>
    LOCALES.map((lang) => {
      const alternates = LOCALES.map(
        (alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${loc(alt, page.path)}"/>`,
      ).join('\n');
      return (
        '<url>\n' +
        `<loc>${loc(lang, page.path)}</loc>\n` +
        `${alternates}\n` +
        `<changefreq>${page.changefreq}</changefreq>\n` +
        `<priority>${page.priority}</priority>\n` +
        '</url>'
      );
    }),
  ).join('\n');

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    `${urls}\n` +
    '</urlset>\n';

  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
