import { isNotFound, isRedirect } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UI } from '../src/i18n';
import { ENTRY_CACHE_CONTROL } from '../src/lib/cache-policy';
import { CANONICAL_ORIGIN } from '../src/lib/canonical';
import {
  PRIVATE_RAILS_ORIGIN,
  PUBLISHING_AUDIENCE,
  PUBLISHING_SURFACE,
} from '../src/lib/publishing-cell';
import { PUBLISHING_STATUS_HEADER } from '../src/lib/publishing-status';
import { SEARCH_FIXTURES } from '../src/lib/search/search-fixtures';
import { siteCopy } from '../src/lib/site-copy';
import { BRAND_TITLE } from '../src/lib/title';
import { Route as entryRoute } from '../src/routes/$lang.entries.$publicId';
import { Route as entriesRoute } from '../src/routes/$lang.entries.index';
import { Route as pageRoute } from '../src/routes/$lang.entries.page.$page';
import { Route as homeRoute } from '../src/routes/$lang.index';
import { Route as searchRoute } from '../src/routes/$lang.search';
import { resetEnv, setEnv } from './__mocks__/cloudflare-workers';
import { headersOf, renderDocument, runLoader } from './utils/routes';

/*
 * Every public route of the contract, rendered through the real router with
 * Rails replaced by an injected VPC binding — the one layer that can make Rails
 * answer whatever a case needs. The HTTP status line and response headers of a
 * real request are asserted by `api/publishing.hurl`.
 */
const STAFF = 'https://www.umaxica.org';
const CELL_PATH = `/publishing/${PUBLISHING_SURFACE}/${PUBLISHING_AUDIENCE}/entries`;

const entry = (overrides: Record<string, unknown> = {}) => ({
  public_id: '01ABC',
  namespace: PUBLISHING_SURFACE,
  surface: PUBLISHING_AUDIENCE,
  slug: 'welcome',
  locale: 'ja',
  title: 'ようこそ',
  summary: '要約',
  body: { text: 'ENTRY-BODY-MARKER' },
  published_at: '2026-09-03T00:00:00Z',
  taxonomy: {},
  ...overrides,
});

function rails(...responses: Response[]) {
  const fetch = vi.fn((_input: string, _init?: RequestInit) =>
    Promise.resolve(responses.shift() ?? new Response(null, { status: 599 })),
  );
  setEnv({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch }, RAILS_STAFF_BASE_ORIGIN: STAFF });
  return fetch;
}

const requestedPath = (fetch: ReturnType<typeof rails>, n = 0) => {
  const url = new URL(String(fetch.mock.calls[n]?.[0]));
  return { origin: url.origin, path: url.pathname + url.search };
};

const titleOf = (html: string) => /<title>([^<]*)<\/title>/u.exec(html)?.[1];
const titles = (html: string) => html.match(/<title>/gu)?.length ?? 0;

afterEach(resetEnv);

describe('/{lang}/ home', () => {
  it.each(['ja', 'en'] as const)(
    'renders %s with lang, title, canonical and hreflang',
    async (lang) => {
      const html = await renderDocument(`/${lang}/`);
      const copy = siteCopy(lang);

      expect(html).toContain(`<html lang="${lang}"`);
      expect(titleOf(html)).toBe(`${copy.product} — ${BRAND_TITLE}`);
      expect(html).toContain(copy.heading);
      expect(html).toContain(`<link rel="canonical" href="${CANONICAL_ORIGIN}/${lang}/"`);
      // HTML attribute names are case-insensitive; React serializes `hrefLang`.
      expect(html.toLowerCase()).toContain(
        `<link rel="alternate" hreflang="en" href="${CANONICAL_ORIGIN}/en/"`.toLowerCase(),
      );
      expect(html.toLowerCase()).toContain(
        `hreflang="x-default" href="${CANONICAL_ORIGIN}/ja/"`.toLowerCase(),
      );
      expect(html).toContain(`href="/${lang}/entries/"`);
      expect(html).toContain(`href="/${lang}/search/"`);
      expect(headersOf(homeRoute, undefined)).toBeUndefined();
    },
  );

  it('keeps navigation in the page locale', async () => {
    const html = await renderDocument('/en/');
    expect(html).toContain('href="/en/"');
    expect(html).toContain('href="/en/about/"');
    expect(html).not.toContain('href="/ja/entries/"');
  });
});

describe('unsupported locales', () => {
  it.each(['/fr/', '/foo/', '/JA/', '/fr/entries/', '/fr/search/'])(
    '%s is the 404 document, never a supported locale',
    async (path) => {
      const fetch = rails();
      const html = await renderDocument(path);
      expect(html).toContain('HTTP 404');
      expect(titles(html)).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe('/{lang}/entries/ and /{lang}/entries/page/{N}/', () => {
  const page = (current: number, previous: number | null, next: number | null, locale = 'ja') =>
    Response.json({
      data: [
        entry({ locale, public_id: `id-${String(current)}`, title: `Entry ${String(current)}` }),
      ],
      page: { current, previous, next, last: 3 },
    });

  it('page 1 fetches only page 1, links Next to /page/2/ and has no Previous', async () => {
    const fetch = rails(page(1, null, 2));
    const html = await renderDocument('/ja/entries/');

    expect(fetch).toHaveBeenCalledOnce();
    expect(requestedPath(fetch)).toEqual({
      origin: PRIVATE_RAILS_ORIGIN,
      path: '/api/v0/entries?locale=ja',
    });
    expect(html).toContain('href="/ja/entries/id-1/"');
    expect(html).toContain('href="/ja/entries/page/2/" rel="next"');
    expect(html).not.toContain('rel="prev"');
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL_ORIGIN}/ja/entries/"`);
    expect(html).toContain(`href="${STAFF}${CELL_PATH}"`);
    expect(html).toContain(`>${UI.ja.manage}<`);
    expect(html).not.toContain('/page/1/');
  });

  it('page 2 fetches only page 2 and links Previous to /entries/', async () => {
    const fetch = rails(page(2, 1, 3, 'en'));
    const html = await renderDocument('/en/entries/page/2/');

    expect(fetch).toHaveBeenCalledOnce();
    expect(requestedPath(fetch).path).toBe('/api/v0/entries?locale=en&page=2');
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('href="/en/entries/" rel="prev"');
    expect(html).toContain('href="/en/entries/page/3/" rel="next"');
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL_ORIGIN}/en/entries/page/2/"`);
    expect(titleOf(html)).toBe(`${UI.en.entriesPageTitle(2)} — ${BRAND_TITLE}`);
    expect(html).not.toContain('/page/1/');
  });

  it('/page/1/ is a permanent redirect to /entries/, decided before Rails is asked', async () => {
    const fetch = rails();
    const thrown: unknown = await runLoader(pageRoute, { lang: 'ja', page: '1' }).catch(
      (error: unknown) => error,
    );
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ options: { href: '/ja/entries/', statusCode: 301 } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'foo', '1.5', '01'])('/page/%s/ is not found, never page 1', async (raw) => {
    const fetch = rails();
    const thrown: unknown = await runLoader(pageRoute, { lang: 'ja', page: raw }).catch(
      (error: unknown) => error,
    );
    expect(isNotFound(thrown)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(await renderDocument(`/ja/entries/page/${raw}/`)).toContain('HTTP 404');
  });

  it('renders the empty state', async () => {
    rails(Response.json({ data: [], page: { current: 1, previous: null, next: null, last: 1 } }));
    const html = await renderDocument('/ja/entries/');
    expect(html).toContain(UI.ja.entriesEmpty);
    expect(html).not.toContain('aria-label="ページ送り"');
  });

  it('keeps the collection no-store and out of the entry cache policy', () => {
    for (const route of [entriesRoute, pageRoute]) {
      expect(headersOf(route, { kind: 'ok' })).toEqual({ 'Cache-Control': 'no-store' });
      expect(JSON.stringify(headersOf(route, { kind: 'ok' }))).not.toContain('public');
    }
  });

  it('renders an upstream failure as an uncacheable, generic document', async () => {
    rails(new Response('<h1>Rails stack trace</h1>', { status: 500 }));
    const html = await renderDocument('/ja/entries/');
    expect(html).toContain(UI.ja.unavailableHeading);
    expect(html).toContain('HTTP 502');
    expect(html).not.toContain('stack trace');
    expect(html).not.toContain(new URL(PRIVATE_RAILS_ORIGIN).host);
    expect(titles(html)).toBe(1);
    expect(headersOf(entriesRoute, { kind: 'error', status: 502 })).toMatchObject({
      'Cache-Control': 'no-store',
      [PUBLISHING_STATUS_HEADER]: '502',
    });
  });
});

describe('/{lang}/entries/{public_id}/', () => {
  it('renders the Entry by public_id and locale, with the edit link', async () => {
    const fetch = rails(Response.json(entry()));
    const html = await renderDocument('/ja/entries/01ABC/');

    expect(requestedPath(fetch)).toEqual({
      origin: PRIVATE_RAILS_ORIGIN,
      path: '/api/v0/entries/01ABC?locale=ja',
    });
    expect(titleOf(html)).toBe(`ようこそ — ${BRAND_TITLE}`);
    expect(html).toContain('ENTRY-BODY-MARKER');
    expect(html).toContain(`href="${STAFF}${CELL_PATH}/01ABC/edit"`);
    expect(html).toContain(`>${UI.ja.edit}<`);
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL_ORIGIN}/ja/entries/01ABC/"`);
    expect(html).not.toContain('/welcome');
  });

  it('forwards the English locale to Rails', async () => {
    const fetch = rails(Response.json(entry({ locale: 'en', title: 'Welcome' })));
    const html = await renderDocument('/en/entries/01ABC/');
    expect(requestedPath(fetch).path).toBe('/api/v0/entries/01ABC?locale=en');
    expect(html).toContain('<html lang="en"');
    expect(html).toContain(`>${UI.en.edit}<`);
  });

  it('is the only route that carries the public cache policy, and only for content', () => {
    expect(headersOf(entryRoute, { kind: 'ok' })).toEqual({ 'Cache-Control': ENTRY_CACHE_CONTROL });
    expect(headersOf(entryRoute, undefined)).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(headersOf(entryRoute, { kind: 'error', status: 504 })).toMatchObject({
      'Cache-Control': 'no-store',
      [PUBLISHING_STATUS_HEADER]: '504',
    });
    expect(headersOf(searchRoute, { query: '', results: [] })).toBeUndefined();
    expect(headersOf(homeRoute, undefined)).toBeUndefined();
  });

  it('answers a Rails 404 with the 404 document', async () => {
    rails(new Response(null, { status: 404 }));
    const html = await renderDocument('/ja/entries/missing/');
    expect(html).toContain('HTTP 404');
    expect(titles(html)).toBe(1);
  });

  it.each([
    ['another surface', { namespace: 'other' }],
    ['another audience', { surface: 'other' }],
    ['another locale', { locale: 'en' }],
  ])('never renders an Entry from %s', async (_label, override) => {
    rails(Response.json(entry(override)));
    const html = await renderDocument('/ja/entries/01ABC/');
    expect(html).not.toContain('ENTRY-BODY-MARKER');
    expect(html).toContain('HTTP 502');
  });
});

describe('/{lang}/search/', () => {
  const mine = SEARCH_FIXTURES.filter(
    (fixture) =>
      fixture.surface === PUBLISHING_SURFACE &&
      fixture.audience === PUBLISHING_AUDIENCE &&
      fixture.locale === 'ja',
  );

  it.each(['ja', 'en'] as const)('renders the %s search form with its label', async (lang) => {
    const html = await renderDocument(`/${lang}/search/`);
    expect(html).toContain(`<html lang="${lang}"`);
    expect(html).toContain(`action="/${lang}/search/"`);
    expect(html).toContain('name="q"');
    expect(html).toContain(`>${UI[lang].searchLabel}<`);
    expect(html).toContain(UI[lang].searchPrompt);
    expect(html).toContain(UI[lang].searchTemporaryNotice);
    expect(html).not.toContain('noindex');
  });

  it('lists this cell’s fixture results, linked by public_id in the same locale', async () => {
    const target = mine[0];
    const html = await renderDocument(`/ja/search/?q=${encodeURIComponent(target?.title ?? '')}`);

    expect(html).toContain(`href="/ja/entries/${target?.publicId ?? ''}/"`);
    expect(html).toContain(UI.ja.searchResultCount(1, target?.title ?? ''));
    expect(html).toContain('noindex, follow');
    for (const [, id] of html.matchAll(/href="\/ja\/entries\/([^/"]+)\/"/gu)) {
      expect(id?.startsWith(`fixture-${PUBLISHING_SURFACE}-${PUBLISHING_AUDIENCE}-ja-`)).toBe(true);
    }
  });

  it('says so when nothing matches, and escapes the query', async () => {
    const html = await renderDocument('/en/search/?q=%3Cscript%3Ezzzz');
    expect(html).toContain(
      UI.en.searchNoResults('<script>zzzz').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    );
    expect(html).not.toContain('<script>zzzz');
  });
});
