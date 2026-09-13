import { describe, expect, it, vi } from 'vitest';

import type { RailsClient, RailsClientResult } from '../../src/lib/rails-client';
import { createRailsEntriesClient } from '../../src/lib/rails-entries';

const entry = {
  public_id: 'entry-1',
  namespace: 'info',
  surface: 'app',
  slug: 'welcome',
  locale: 'ja',
  title: 'Welcome',
  summary: null,
  body: { text: 'Body' },
  published_at: '2026-09-03T00:00:00Z',
  taxonomy: {},
};

const firstPage = {
  data: [entry],
  page: { current: 1, previous: null, next: 2, last: 3 },
};

function client(...results: RailsClientResult[]) {
  const fetch = vi.fn(() =>
    Promise.resolve(results.shift() ?? { kind: 'invalid-path', reason: 'test result missing' }),
  );
  return { entries: createRailsEntriesClient({ fetch } as RailsClient), fetch };
}

describe('Rails entries client', () => {
  it('uses fixed, encoded entry and collection API paths with only an Accept header', async () => {
    const { entries, fetch } = client(
      { kind: 'ok', status: 200, response: Response.json(entry) },
      {
        kind: 'ok',
        status: 200,
        response: Response.json({
          ...firstPage,
          ignored_by_client: true,
        }),
      },
    );

    await expect(
      entries.fetchEntry({ publicId: 'id/-safe space?', locale: 'ja' }),
    ).resolves.toMatchObject({
      kind: 'ok',
    });
    await expect(entries.fetchEntriesPage({ locale: 'ja', page: 2 })).resolves.toMatchObject({
      kind: 'ok',
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v0/entries/id%2F-safe%20space%3F?locale=ja', {
      headers: { Accept: 'application/json' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v0/entries?locale=ja&page=2', {
      headers: { Accept: 'application/json' },
    });
  });

  it('omits page when requesting the first collection page', async () => {
    const { entries, fetch } = client({
      kind: 'ok',
      status: 200,
      response: Response.json(firstPage),
    });

    await expect(entries.fetchEntriesPage({ locale: 'ja' })).resolves.toMatchObject({ kind: 'ok' });
    expect(fetch).toHaveBeenCalledWith('/api/v0/entries?locale=ja', {
      headers: { Accept: 'application/json' },
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('cursor');
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('offset');
  });

  it('parses valid entries and tolerates additive response fields', async () => {
    const { entries } = client({
      kind: 'ok',
      status: 200,
      response: Response.json({ ...entry, additive: { field: true } }),
    });

    await expect(entries.fetchEntry({ publicId: 'entry-1', locale: 'ja' })).resolves.toMatchObject({
      kind: 'ok',
      value: entry,
    });
  });

  it.each([
    [404, 'not-found'],
    [500, 'upstream-error'],
  ] as const)('classifies Rails HTTP %i as %s', async (status, kind) => {
    const { entries } = client({
      kind: 'http-error',
      status,
      response: new Response(null, { status }),
    });

    await expect(entries.fetchEntry({ publicId: 'entry-1', locale: 'ja' })).resolves.toMatchObject({
      kind,
    });
  });

  it('classifies transport failures and timeout without exposing the transport error', async () => {
    const unreachable = client({ kind: 'unreachable', errorMessage: 'private upstream details' });
    await expect(
      unreachable.entries.fetchEntry({ publicId: 'entry-1', locale: 'ja' }),
    ).resolves.toEqual({
      kind: 'unreachable',
    });

    const timeout = client({ kind: 'timeout' } as unknown as RailsClientResult);
    await expect(
      timeout.entries.fetchEntry({ publicId: 'entry-1', locale: 'ja' }),
    ).resolves.toEqual({
      kind: 'timeout',
    });
  });

  it('rejects malformed JSON and malformed entry fields', async () => {
    const malformedJson = client({ kind: 'ok', status: 200, response: new Response('{') });
    await expect(
      malformedJson.entries.fetchEntry({ publicId: 'entry-1', locale: 'ja' }),
    ).resolves.toMatchObject({
      kind: 'invalid-contract',
    });

    const wrongField = client({
      kind: 'ok',
      status: 200,
      response: Response.json({ ...entry, title: 42 }),
    });
    await expect(
      wrongField.entries.fetchEntry({ publicId: 'entry-1', locale: 'ja' }),
    ).resolves.toMatchObject({
      kind: 'invalid-contract',
    });
  });

  it('rejects a cursor-era collection envelope', async () => {
    const { entries, fetch } = client({
      kind: 'ok',
      status: 200,
      response: Response.json({
        data: [entry],
        page: { next_cursor: 'next/2', has_more: true },
      }),
    });

    await expect(entries.fetchEntriesPage({ locale: 'ja' })).resolves.toMatchObject({
      kind: 'invalid-contract',
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('cursor');
  });

  it('maps an invalid-path client result to upstream-error without its reason', async () => {
    const { entries } = client({ kind: 'invalid-path', reason: 'path must not be empty' });

    const result = await entries.fetchEntry({ publicId: 'entry-1', locale: 'ja' });

    expect(result).toEqual({ kind: 'upstream-error' });
    expect(JSON.stringify(result)).not.toContain('path must not be empty');
  });

  it('does not offer arbitrary paths or origins, and rejects a non-positive page before calling Rails', async () => {
    const { entries, fetch } = client({ kind: 'ok', status: 200, response: Response.json(entry) });

    await expect(entries.fetchEntriesPage({ locale: 'ja', page: 0 })).resolves.toEqual({
      kind: 'invalid-contract',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
