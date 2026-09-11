import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n';
import { CANONICAL_ORIGIN } from './canonical';

/*
 * The head every localized document on this unit emits: `<title>`, the meta
 * description, `<link rel="canonical">` and one hreflang alternate per locale
 * plus `x-default`.
 *
 * `path` is the page's path BELOW the locale prefix (`/`, `/entries/`,
 * `/entries/page/2/`, `/entries/{public_id}/`), so the canonical URL is
 * self-referencing — page 2 canonicalizes to page 2, never to page 1 — and the
 * alternates point at the same page in the other language. Absolute URLs are
 * always on this unit's public origin; no private or development host can
 * appear here.
 */
export interface DocumentHeadInput {
  locale: Locale;
  title: string;
  description: string;
  path: string;
  /** For documents that must stay out of the index (search results). */
  noindex?: boolean;
}

export interface DocumentHead {
  meta: ({ title: string } | { name: string; content: string })[];
  links: { rel: string; href: string; hrefLang?: string }[];
}

function absolute(locale: Locale, path: string): string {
  return new URL(`/${locale}${path}`, CANONICAL_ORIGIN).href;
}

export function documentHead({
  locale,
  title,
  description,
  path,
  noindex = false,
}: DocumentHeadInput): DocumentHead {
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      ...(noindex ? [{ name: 'robots', content: 'noindex, follow' }] : []),
    ],
    links: [
      { rel: 'canonical', href: absolute(locale, path) },
      ...LOCALES.map((alternate) => ({
        rel: 'alternate',
        hrefLang: alternate,
        href: absolute(alternate, path),
      })),
      { rel: 'alternate', hrefLang: 'x-default', href: absolute(DEFAULT_LOCALE, path) },
    ],
  };
}

/** A failure document: titled, never indexed, never canonical. */
export function failureHead(title: string): DocumentHead {
  return {
    meta: [{ title }, { name: 'robots', content: 'noindex, nofollow' }],
    links: [],
  };
}
