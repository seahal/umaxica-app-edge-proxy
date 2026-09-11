import { describe, expect, it, vi } from 'vitest';

import {
  THIS_CELL,
  belongsToPublishingCell,
  createPublishingApi,
  optionalEntryBodyText,
  publishingHttpStatus,
  resolvePublishingApi,
  type PublishingResult,
} from '../../src/lib/publishing-api';
import { PUBLISHING_AUDIENCE, PUBLISHING_SURFACE } from '../../src/lib/publishing-cell';
import type { RailsClient, RailsClientResult } from '../../src/lib/rails-client';
import type { RailsEntry } from '../../src/lib/rails-entries';

const entry: RailsEntry = {
  public_id: '01ABC',
  namespace: PUBLISHING_SURFACE,
  surface: PUBLISHING_AUDIENCE,
  slug: 'welcome',
  locale: 'ja',
  title: 'Welcome',
  summary: 'A summary',
  body: { text: 'Body' },
  published_at: '2026-09-03T00:00:00Z',
  taxonomy: {},
};

const onePage = (data: unknown[]) => ({
  data,
  page: { current: 1, previous: null, next: null, last: 1 },
});

function client(...results: RailsClientResult[]) {
  const fetch = vi.fn(() =>
    Promise.resolve(results.shift() ?? { kind: 'invalid-path', reason: 'test result missing' }),
  );
  return { api: createPublishingApi({ fetch } as RailsClient), fetch };
}

const ok = (body: unknown): RailsClientResult => ({
  kind: 'ok',
  status: 200,
  response: Response.json(body),
});

describe('this cell', () => {
  it('is the statically declared surface and audience', () => {
    expect(THIS_CELL).toEqual({ surface: PUBLISHING_SURFACE, audience: PUBLISHING_AUDIENCE });
  });

  it('matches Rails namespace to surface and Rails surface to audience', () => {
    expect(belongsToPublishingCell(entry, THIS_CELL)).toBe(true);
    expect(
      belongsToPublishingCell(
        { namespace: PUBLISHING_AUDIENCE, surface: PUBLISHING_SURFACE },
        THIS_CELL,
      ),
    ).toBe(false);
  });
});

describe('cell and locale isolation', () => {
  it('accepts an Entry and a page from this cell in the requested locale', async () => {
    const { api } = client(ok(entry), ok(onePage([entry])));
    await expect(api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({ kind: 'ok' });
    await expect(api.fetchEntriesPage({ locale: 'ja' })).resolves.toMatchObject({ kind: 'ok' });
  });

  it.each([
    ['another surface', { namespace: 'other' }],
    ['another audience', { surface: 'other' }],
    ['another locale', { locale: 'en' }],
  ])('refuses an Entry from %s', async (_label, override) => {
    const { api } = client(ok({ ...entry, ...override }), ok(onePage([{ ...entry, ...override }])));
    await expect(api.fetchEntry('01ABC', 'ja')).resolves.toMatchObject({
      kind: 'invalid-contract',
    });
    await expect(api.fetchEntriesPage({ locale: 'ja' })).resolves.toMatchObject({
      kind: 'invalid-contract',
    });
  });

  it('refuses a page when any one Entry on it is foreign', async () => {
    const { api } = client(ok(onePage([entry, { ...entry, public_id: 'x', namespace: 'other' }])));
    await expect(api.fetchEntriesPage({ locale: 'ja' })).resolves.toMatchObject({
      kind: 'invalid-contract',
    });
  });

  it('passes a failure through untouched', async () => {
    const { api } = client({ kind: 'timeout' });
    await expect(api.fetchEntry('01ABC', 'ja')).resolves.toEqual({ kind: 'timeout' });
  });
});

describe('publishing HTTP mapping', () => {
  it.each([
    [{ kind: 'ok', value: entry, upstreamStatus: 200 }, 200],
    [{ kind: 'not-found', upstreamStatus: 404 }, 404],
    [{ kind: 'upstream-error', upstreamStatus: 500 }, 502],
    [{ kind: 'upstream-error', upstreamStatus: 401 }, 502],
    [{ kind: 'upstream-error', upstreamStatus: 403 }, 502],
    [{ kind: 'upstream-error', upstreamStatus: 302 }, 502],
    [{ kind: 'upstream-error', upstreamStatus: 429 }, 503],
    [{ kind: 'upstream-error' }, 502],
    [{ kind: 'unreachable' }, 503],
    [{ kind: 'not-configured' }, 503],
    [{ kind: 'timeout' }, 504],
    [{ kind: 'invalid-contract' }, 502],
    [{ kind: 'internal-error' }, 500],
  ] as [PublishingResult<unknown>, number][])('maps %j to HTTP %i', (result, status) => {
    expect(publishingHttpStatus(result)).toBe(status);
  });
});

describe('optional body text', () => {
  it('uses body.text only when it is a non-empty string', () => {
    expect(optionalEntryBodyText({ text: 'Hello' })).toBe('Hello');
    expect(optionalEntryBodyText({ text: '' })).toBeNull();
    expect(optionalEntryBodyText({})).toBeNull();
    expect(optionalEntryBodyText({ text: 1 })).toBeNull();
  });
});

describe('resolvePublishingApi', () => {
  it('returns not-configured when no Rails transport exists', () => {
    expect(resolvePublishingApi({})).toEqual({ kind: 'not-configured' });
  });

  it('builds a publishing API when the VPC binding is present', () => {
    const resolved = resolvePublishingApi({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch: vi.fn() } });
    expect(resolved).toHaveProperty('fetchEntry');
    expect(resolved).toHaveProperty('fetchEntriesPage');
  });

  it('returns internal-error when env access throws', () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error('unavailable');
        },
      },
    );
    expect(resolvePublishingApi(throwing)).toEqual({ kind: 'internal-error' });
  });
});
