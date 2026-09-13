import { describe, expect, it, vi } from 'vitest';

import type { EdgeBindings } from '../../src/lib/env';
import {
  PRIVATE_RAILS_ORIGIN,
  PUBLISHING_AUDIENCE,
  PUBLISHING_SURFACE,
} from '../../src/lib/publishing-cell';
import { readEntriesPage, readEntry } from '../../src/lib/publishing-data';

const STAFF = 'https://www.umaxica.org';

const entry = (overrides: Record<string, unknown> = {}) => ({
  public_id: '01ABC',
  namespace: PUBLISHING_SURFACE,
  surface: PUBLISHING_AUDIENCE,
  slug: 'welcome',
  locale: 'ja',
  title: 'Welcome',
  summary: 'A summary',
  body: { text: 'Body', internal: { secret: 'must-not-reach-the-page' } },
  published_at: '2026-09-03T00:00:00Z',
  taxonomy: { tags: ['x'] },
  ...overrides,
});

function envWith(...responses: Response[]) {
  const fetch = vi.fn((_input: string, _init?: RequestInit) =>
    Promise.resolve(responses.shift() ?? new Response(null, { status: 599 })),
  );
  const env: EdgeBindings = {
    UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch },
    RAILS_STAFF_BASE_ORIGIN: STAFF,
  };
  return { env, fetch };
}

const requested = (fetch: ReturnType<typeof envWith>['fetch'], n = 0) =>
  new URL(String(fetch.mock.calls[n]?.[0]));

describe('readEntriesPage', () => {
  it('asks Rails for exactly page 1 with no page parameter', async () => {
    const { env, fetch } = envWith(
      Response.json({
        data: [entry()],
        page: { current: 1, previous: null, next: 2, last: 3 },
      }),
    );

    const view = await readEntriesPage('ja', 1, env);

    expect(requested(fetch).origin).toBe(PRIVATE_RAILS_ORIGIN);
    expect(requested(fetch).pathname + requested(fetch).search).toBe('/api/v0/entries?locale=ja');
    expect(fetch).toHaveBeenCalledOnce();
    expect(view).toEqual({
      kind: 'ok',
      entries: [
        { publicId: '01ABC', title: 'Welcome', summary: 'A summary', href: '/ja/entries/01ABC/' },
      ],
      page: { current: 1, last: 3, previousHref: null, nextHref: '/ja/entries/page/2/' },
      manageHref: `${STAFF}/publishing/${PUBLISHING_SURFACE}/${PUBLISHING_AUDIENCE}/entries`,
    });
  });

  it('asks Rails for exactly page N, once, and links page 1 as /entries/', async () => {
    const { env, fetch } = envWith(
      Response.json({
        data: [entry({ locale: 'en' })],
        page: { current: 2, previous: 1, next: 3, last: 3 },
      }),
    );

    const view = await readEntriesPage('en', 2, env);

    expect(requested(fetch).search).toBe('?locale=en&page=2');
    expect(fetch).toHaveBeenCalledOnce();
    expect(view).toMatchObject({
      kind: 'ok',
      page: { previousHref: '/en/entries/', nextHref: '/en/entries/page/3/' },
    });
    expect(JSON.stringify(view)).not.toContain('/page/1/');
  });

  it('treats a page Rails does not confirm as not-found', async () => {
    const { env } = envWith(
      Response.json({ data: [], page: { current: 3, previous: 2, next: null, last: 3 } }),
    );
    await expect(readEntriesPage('ja', 9, env)).resolves.toEqual({ kind: 'not-found' });
  });

  it('carries no Rails body, taxonomy or private host into the view', async () => {
    const { env } = envWith(
      Response.json({ data: [entry()], page: { current: 1, previous: null, next: null, last: 1 } }),
    );
    const serialized = JSON.stringify(await readEntriesPage('ja', 1, env));
    expect(serialized).not.toContain('must-not-reach-the-page');
    expect(serialized).not.toContain('tags');
    expect(serialized).not.toContain(new URL(PRIVATE_RAILS_ORIGIN).host);
  });
});

describe('readEntry', () => {
  it('looks the Entry up by public_id and locale and links edit by public_id', async () => {
    const { env, fetch } = envWith(Response.json(entry({ slug: 'welcome-slug' })));

    const view = await readEntry('ja', '01ABC', env);

    expect(requested(fetch).pathname).toBe('/api/v0/entries/01ABC');
    expect(requested(fetch).search).toBe('?locale=ja');
    expect(view).toEqual({
      kind: 'ok',
      entry: {
        publicId: '01ABC',
        title: 'Welcome',
        summary: 'A summary',
        bodyText: 'Body',
        publishedAt: '2026-09-03T00:00:00Z',
      },
      editHref: `${STAFF}/publishing/${PUBLISHING_SURFACE}/${PUBLISHING_AUDIENCE}/entries/01ABC/edit`,
    });
    expect(JSON.stringify(view)).not.toContain('welcome-slug');
  });

  it.each([
    ['Rails 404', () => new Response(null, { status: 404 }), { kind: 'not-found' }],
    ['Rails 401', () => new Response(null, { status: 401 }), { kind: 'error', status: 502 }],
    ['Rails 403', () => new Response(null, { status: 403 }), { kind: 'error', status: 502 }],
    ['Rails 429', () => new Response(null, { status: 429 }), { kind: 'error', status: 503 }],
    ['Rails 500', () => new Response(null, { status: 500 }), { kind: 'error', status: 502 }],
    [
      'an unexpected redirect',
      () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }),
      { kind: 'error', status: 502 },
    ],
    ['an empty 200', () => new Response('', { status: 200 }), { kind: 'error', status: 502 }],
    ['malformed JSON', () => new Response('{', { status: 200 }), { kind: 'error', status: 502 }],
    [
      'VPC failure',
      () =>
        new Response('ProxyError: dns_error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        }),
      { kind: 'error', status: 503 },
    ],
    [
      'a foreign cell',
      () => Response.json(entry({ namespace: 'other' })),
      { kind: 'error', status: 502 },
    ],
  ])('maps %s', async (_label, respond, expected) => {
    const { env } = envWith(respond());
    await expect(readEntry('ja', '01ABC', env)).resolves.toEqual(expected);
  });

  it('maps an upstream timeout to 504', async () => {
    const env: EdgeBindings = {
      UMAXICA_APPS_EDGE_CF_WORKERS_VPC: {
        fetch: () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
      },
      RAILS_STAFF_BASE_ORIGIN: STAFF,
    };
    await expect(readEntry('ja', '01ABC', env)).resolves.toEqual({ kind: 'error', status: 504 });
  });

  it('fails closed to 503 when no Rails transport is configured', async () => {
    await expect(readEntry('ja', '01ABC', {})).resolves.toEqual({ kind: 'error', status: 503 });
    await expect(readEntriesPage('ja', 1, {})).resolves.toEqual({ kind: 'error', status: 503 });
  });

  it('fails to 500 when the staff origin is not a browser-facing origin', async () => {
    const { env } = envWith(Response.json(entry()));
    env.RAILS_STAFF_BASE_ORIGIN = PRIVATE_RAILS_ORIGIN;
    await expect(readEntry('ja', '01ABC', env)).resolves.toEqual({ kind: 'error', status: 500 });

    const collection = envWith(
      Response.json({ data: [], page: { current: 1, previous: null, next: null, last: 1 } }),
    );
    delete collection.env.RAILS_STAFF_BASE_ORIGIN;
    await expect(readEntriesPage('ja', 1, collection.env)).resolves.toEqual({
      kind: 'error',
      status: 500,
    });
  });
});
