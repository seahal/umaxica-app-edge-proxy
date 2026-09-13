import { createFileRoute } from '@tanstack/react-router';

import { LOCALES } from '../i18n';
import { CANONICAL_ORIGIN } from '../lib/canonical';
import { aboutPath, entriesPath, homePath, searchPath } from '../lib/publishing-routes';

/*
 * Every fixed public page in every language, each `<url>` carrying `xhtml:link`
 * alternates so a crawler sees the ja/en pair. Individual Entries are not listed
 * here: Rails does not yet expose a listing endpoint for a dynamic sitemap, and
 * this route must not crawl the collection to build one.
 */
const PAGES = [
  { path: homePath, changefreq: 'weekly', priority: '0.5' },
  { path: entriesPath, changefreq: 'weekly', priority: '0.6' },
  { path: searchPath, changefreq: 'monthly', priority: '0.3' },
  { path: aboutPath, changefreq: 'monthly', priority: '0.3' },
] as const;

function body(): string {
  const urls = PAGES.flatMap((page) =>
    LOCALES.map((locale) => {
      const alternates = LOCALES.map(
        (alternate) =>
          `<xhtml:link rel="alternate" hreflang="${alternate}" href="${CANONICAL_ORIGIN}${page.path(alternate)}"/>`,
      ).join('\n');
      return (
        '<url>\n' +
        `<loc>${CANONICAL_ORIGIN}${page.path(locale)}</loc>\n` +
        `${alternates}\n` +
        `<changefreq>${page.changefreq}</changefreq>\n` +
        `<priority>${page.priority}</priority>\n` +
        '</url>'
      );
    }),
  ).join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    `${urls}\n` +
    '</urlset>\n'
  );
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: () => new Response(body(), { headers: { 'Content-Type': 'application/xml' } }),
    },
  },
});
