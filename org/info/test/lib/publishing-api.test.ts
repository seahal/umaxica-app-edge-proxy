import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  belongsToPublishingCell,
  createPublishingApi,
  entriesIndexPath,
  entryPublicPath,
  optionalEntryBodyText,
  publishingErrorHtml,
  publishingErrorResponse,
  publishingHttpStatus,
  railsLocaleFromPathLang,
  resolvePublishingApi,
  type PublishingResult,
} from '../../src/lib/publishing-api';
import type { RailsClient, RailsClientResult } from '../../src/lib/rails-client';
import type { RailsEntry } from '../../src/lib/rails-entries';

const entry: RailsEntry = {
  public_id: '01ABC',
  namespace: 'info',
  surface: 'org',
  slug: 'welcome',
  locale: 'ja',
  title: 'Welcome',
  summary: 'A summary',
  body: { text: 'Body' },
  published_at: '2026-09-03T00:00:00Z',
  taxonomy: {},
};

function client(...results: RailsClientResult[]) {
  const fetch = vi.fn(() =>
    Promise.resolve(results.shift() ?? { kind: 'invalid-path', reason: 'test result missing' }),
  );
  return {
    api: createPublishingApi({ fetch } as RailsClient, { namespace: 'info', surface: 'org' }),
    fetch,
  };
}

describe('language → Rails locale', () => {
  it('maps path langs onto the Rails locale enum and rejects anything else', () => {
    expect(railsLocaleFromPathLang('ja')).toBe('ja');
    expect(railsLocaleFromPathLang('en')).toBe('en');
    expect(railsLocaleFromPathLang('fr')).toBeNull();
    expect(railsLocaleFromPathLang(undefined)).toBeNull();
  });
});

describe('publishing API parsing', () => {
  it('parses an entries index and a single Entry, linking by public_id', async () => {
    const { api, fetch } = client(
      {
        kind: 'ok',
        status: 200,
        response: Response.json({
          data: [entry],
          page: { next_cursor: null, has_more: false },
        }),
      },
      { kind: 'ok', status: 200, response: Response.json(entry) },
    );

    const index = await api.fetchEntriesPage({ locale: 'ja' });
    const show = await api.fetchEntry('01ABC', 'ja');

    expect(index).toMatchObject({ kind: 'ok' });
    expect(show).toMatchObject({ kind: 'ok', value: { public_id: '01ABC' } });
    expect(entryPublicPath('ja', '01ABC')).toBe('/ja/entries/01ABC/');
    expect(entriesIndexPath('en')).toBe('/en/entries/');
    expect(entriesIndexPath('ja', 'next/2')).toBe('/ja/entries/?cursor=next%2F2');
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v0/entries?locale=ja', {
      headers: { Accept: 'application/json' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v0/entries/01ABC?locale=ja', {
      headers: { Accept: 'application/json' },
    });
  });

  it('rejects invalid JSON and a schema-invalid 2xx body', async () => {
    const invalidJson = client({ kind: 'ok', status: 200, response: new Response('{') });
    await expect(invalidJson.api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({
      kind: 'invalid-contract',
    });

    const schemaInvalid = client({
      kind: 'ok',
      status: 200,
      response: Response.json({ ...entry, title: 42 }),
    });
    await expect(schemaInvalid.api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({
      kind: 'invalid-contract',
    });
  });

  it('rejects an Entry that belongs to another namespace or surface', async () => {
    const foreign = client({
      kind: 'ok',
      status: 200,
      response: Response.json({ ...entry, namespace: 'other', surface: 'other' }),
    });
    await expect(foreign.api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({
      kind: 'invalid-contract',
    });

    const foreignIndex = client({
      kind: 'ok',
      status: 200,
      response: Response.json({
        data: [{ ...entry, namespace: 'other', surface: 'other' }],
        page: { next_cursor: null, has_more: false },
      }),
    });
    await expect(foreignIndex.api.fetchEntriesPage({ locale: 'ja' })).resolves.toMatchObject({
      kind: 'invalid-contract',
    });
    expect(
      belongsToPublishingCell(
        { ...entry, namespace: 'other', surface: 'other' },
        { namespace: 'other', surface: 'other' },
      ),
    ).toBe(true);
    expect(
      belongsToPublishingCell(
        { ...entry, namespace: 'other' },
        { namespace: 'never', surface: 'never' },
      ),
    ).toBe(false);
  });
});

describe('publishing HTTP mapping', () => {
  it.each([
    [{ kind: 'ok', value: entry, upstreamStatus: 200 } satisfies PublishingResult<RailsEntry>, 200],
    [{ kind: 'not-found', upstreamStatus: 404 } satisfies PublishingResult<never>, 404],
    [{ kind: 'upstream-error', upstreamStatus: 500 } satisfies PublishingResult<never>, 502],
    [{ kind: 'upstream-error', upstreamStatus: 401 } satisfies PublishingResult<never>, 502],
    [{ kind: 'upstream-error', upstreamStatus: 403 } satisfies PublishingResult<never>, 502],
    [{ kind: 'upstream-error', upstreamStatus: 429 } satisfies PublishingResult<never>, 503],
    [{ kind: 'unreachable' } satisfies PublishingResult<never>, 503],
    [{ kind: 'not-configured' } satisfies PublishingResult<never>, 503],
    [{ kind: 'timeout' } satisfies PublishingResult<never>, 504],
    [{ kind: 'invalid-contract' } satisfies PublishingResult<never>, 502],
    [{ kind: 'internal-error' } satisfies PublishingResult<never>, 500],
  ] as const)('maps %j to HTTP %i', (result, status) => {
    expect(publishingHttpStatus(result)).toBe(status);
  });

  it('classifies Rails 404, 5xx, timeout, and VPC unavailability through the client', async () => {
    const missing = client({
      kind: 'http-error',
      status: 404,
      response: new Response(null, { status: 404 }),
    });
    await expect(missing.api.fetchEntry('missing', 'en')).resolves.toMatchObject({
      kind: 'not-found',
    });

    const rails5xx = client({
      kind: 'http-error',
      status: 500,
      response: new Response(null, { status: 500 }),
    });
    await expect(rails5xx.api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({
      kind: 'upstream-error',
      upstreamStatus: 500,
    });

    const timeout = client({ kind: 'timeout' } as unknown as RailsClientResult);
    await expect(timeout.api.fetchEntry('01ABC', 'ja')).resolves.toEqual({ kind: 'timeout' });

    const down = client({
      kind: 'unreachable',
      errorMessage: 'ProxyError: destination_unavailable',
    });
    await expect(down.api.fetchEntry('01ABC', 'ja')).resolves.toEqual({ kind: 'unreachable' });

    const limited = client({
      kind: 'http-error',
      status: 429,
      response: new Response(null, { status: 429 }),
    });
    await expect(limited.api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({
      kind: 'upstream-error',
      upstreamStatus: 429,
    });
    expect(publishingHttpStatus({ kind: 'upstream-error', upstreamStatus: 429 })).toBe(503);
  });

  it('does not leak upstream bodies in the public error HTML', () => {
    expect(publishingErrorHtml(404, 'en')).toContain('Page not found');
    expect(publishingErrorHtml(502, 'ja')).toContain('このページを表示できません');
    const html = publishingErrorHtml(502, 'en');
    expect(html).toContain('Unable to display this page');
    expect(html).not.toContain('ProxyError');
    expect(html).not.toContain('info.app.localhost');
    const response = publishingErrorResponse(404, 'ja');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('optional body text', () => {
  it('uses body.text only when it is a non-empty string', () => {
    expect(optionalEntryBodyText({ text: 'Hello' })).toBe('Hello');
    expect(optionalEntryBodyText({})).toBeNull();
    expect(optionalEntryBodyText({ text: 1 })).toBeNull();
  });
});

describe('resolvePublishingApi', () => {
  it('uses this unit cell when createPublishingApi is not given an override', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({
        kind: 'ok' as const,
        status: 200,
        response: Response.json({ ...entry, namespace: 'info', surface: 'org' }),
      }),
    );
    const api = createPublishingApi({ fetch } as RailsClient);
    await expect(api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({ kind: 'ok' });
  });

  it('returns not-configured when no Rails transport exists', () => {
    expect(resolvePublishingApi({})).toEqual({ kind: 'not-configured' });
  });

  it('builds a publishing API when the VPC binding is present', () => {
    const resolved = resolvePublishingApi({
      UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch: vi.fn() },
    });
    expect(resolved).toHaveProperty('fetchEntry');
    expect(resolved).toHaveProperty('fetchEntriesPage');
  });

  it('returns internal-error when env access throws', () => {
    expect(
      resolvePublishingApi(
        new Proxy(
          {},
          {
            get() {
              throw new Error('unavailable');
            },
          },
        ) as never,
      ),
    ).toEqual({ kind: 'internal-error' });
  });
});

describe('publishing pages are on-demand SSR', () => {
  const unitRoot = resolve(import.meta.dirname, '../..');

  it('marks Rails-backed routes as not prerendered and does not fetch Rails from the browser', () => {
    const index = readFileSync(resolve(unitRoot, 'src/pages/[lang]/entries/index.astro'), 'utf8');
    const show = readFileSync(
      resolve(unitRoot, 'src/pages/[lang]/entries/[public_id].astro'),
      'utf8',
    );
    const jaHome = readFileSync(resolve(unitRoot, 'src/pages/ja/index.astro'), 'utf8');
    const about = readFileSync(resolve(unitRoot, 'src/pages/ja/about.astro'), 'utf8');

    for (const source of [index, show]) {
      expect(source).toContain('export const prerender = false');
      expect(source).toContain('resolvePublishingApi');
      expect(source).not.toContain('getStaticPaths');
      expect(source).not.toContain('client:load');
    }
    expect(index).toContain('entryPublicPath');
    expect(jaHome).not.toContain('prerender = false');
    expect(jaHome).not.toContain('resolvePublishingApi');
    expect(jaHome).toContain('client:load');
    expect(jaHome).toContain('PublishedEntries');
    expect(jaHome).toContain('/ja/entries/');
    expect(about).not.toContain('prerender = false');
    expect(about).not.toContain('resolvePublishingApi');
  });
});
