import type { Locale } from '../i18n';

/*
 * The public URL contract, written once.
 *
 *   /{lang}/                         home
 *   /{lang}/about/                   about this site
 *   /{lang}/entries/                 entry collection, page 1 (canonical)
 *   /{lang}/entries/page/{N}/        entry collection, page N >= 2
 *   /{lang}/entries/{public_id}/     one entry
 *   /{lang}/search/                  search
 *
 * Every link, canonical URL, hreflang alternate, sitemap `<loc>` and redirect
 * target on this unit is built here, so no component writes a URL by hand. Every
 * path carries a trailing slash. `/page/1/` is never produced: page 1 is
 * `/entries/`.
 */

export function homePath(locale: Locale): string {
  return `/${locale}/`;
}

export function aboutPath(locale: Locale): string {
  return `/${locale}/about/`;
}

export function entriesPath(locale: Locale, page = 1): string {
  return page <= 1 ? `/${locale}/entries/` : `/${locale}/entries/page/${String(page)}/`;
}

/** `public_id` is the public identity. Never a database id, never a slug. */
export function entryPath(locale: Locale, publicId: string): string {
  return `/${locale}/entries/${encodeURIComponent(publicId)}/`;
}

export function searchPath(locale: Locale, query?: string): string {
  const base = `/${locale}/search/`;
  if (query === undefined || query === '') return base;
  return `${base}?${new URLSearchParams({ q: query }).toString()}`;
}

/** The path below the locale prefix, for canonical and hreflang: `/ja/x/` → `/x/`. */
export function localelessPath(locale: Locale, path: string): string {
  const prefix = `/${locale}`;
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

export type PageParam = { kind: 'page'; page: number } | { kind: 'first' } | { kind: 'invalid' };

/**
 * The `{N}` of `/entries/page/{N}/`, which is untrusted input.
 *
 * Only a canonical decimal integer is a page. `1` is a real page with a
 * different canonical URL, so it is reported as `first` for the route to
 * redirect. Anything else — `0`, `-1`, `01`, `1.5`, `foo`, an absurd length —
 * is `invalid`, and is never rewritten into page 1.
 */
export function parsePageParam(raw: string): PageParam {
  if (!/^[1-9][0-9]{0,8}$/u.test(raw)) return { kind: 'invalid' };
  const page = Number(raw);
  return page === 1 ? { kind: 'first' } : { kind: 'page', page };
}
