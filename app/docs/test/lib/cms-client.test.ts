import { describe, expect, it, vi } from 'vitest';

import { createCmsClient } from '../../src/lib/cms/client';
import type { RailsClient, RailsClientResult } from '../../src/lib/rails-client';

function client(...results: RailsClientResult[]) {
  const queue = [...results];
  const fetch = vi.fn(() => {
    const next = queue.shift();
    if (next === undefined) {
      return Promise.resolve({ kind: 'unreachable' as const, errorMessage: 'extra fetch' });
    }
    return Promise.resolve(next);
  });
  return { cms: createCmsClient({ fetch } as RailsClient), fetch };
}

const payload = {
  public_id: 'httS4Y6517f1XS9SMK0Lu',
  namespace: 'docs',
  surface: 'app',
  slug: 'guide',
  locale: 'ja',
  title: 'Guide',
  summary: 'Summary',
  body: { text: 'Body' },
  published_at: '2026-09-03T00:00:00Z',
  taxonomy: {},
};

const indexPage = {
  data: [payload],
  page: { next_cursor: null, has_more: false },
};

describe('CMS Rails client', () => {
  it('resolves the public slug via the entries index then loads the public_id show', async () => {
    const { cms, fetch } = client(
      { kind: 'ok', status: 200, response: Response.json(indexPage) },
      { kind: 'ok', status: 200, response: Response.json(payload) },
    );
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toMatchObject({ kind: 'ok' });
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v0/entries?locale=ja&limit=100', {
      headers: { Accept: 'application/json' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v0/entries/httS4Y6517f1XS9SMK0Lu?locale=ja', {
      headers: { Accept: 'application/json' },
    });
  });

  it.each([
    [404, 'not-found'],
    [401, 'upstream-access-error'],
    [403, 'upstream-access-error'],
    [429, 'upstream-rate-limited'],
    [500, 'upstream-error'],
    [503, 'upstream-error'],
    [302, 'upstream-protocol-error'],
  ] as const)('maps Rails %i to %s', async (status, kind) => {
    const { cms } = client({
      kind: 'http-error',
      status,
      response: new Response(null, { status }),
    });
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toMatchObject({ kind });
  });

  it.each([
    ['a body Rails did not send', { ...payload, body: undefined }, 'body_missing_or_invalid'],
    ['a field Rails typed differently', { ...payload, title: 42 }, 'schema_mismatch'],
  ] as const)('maps well-formed JSON with %s to invalid-contract', async (_label, body, reason) => {
    // Index lookup succeeds so the show response is what `parseCmsDocument`
    // rejects. The JSON parses and is within the size bound, so neither earlier
    // guard fires; the parse reason is carried through while status stays 200.
    const { cms } = client(
      { kind: 'ok', status: 200, response: Response.json(indexPage) },
      { kind: 'ok', status: 200, response: Response.json(body) },
    );

    await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({
      kind: 'invalid-contract',
      reason,
      upstreamStatus: 200,
    });
  });

  it('maps an invalid Rails path to an internal error', async () => {
    const { cms } = client({ kind: 'invalid-path', reason: 'path must not be empty' });
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({ kind: 'internal-error' });
  });

  it('distinguishes the Astro timeout', async () => {
    const { cms } = client({ kind: 'timeout' });
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({ kind: 'timeout' });
  });

  it('normalizes known and unknown transport errors', async () => {
    for (const [message, transportReason] of [
      ['workerd: dns_error', 'dns_error'],
      ['private detail', 'unknown'],
    ] as const) {
      const { cms } = client({ kind: 'unreachable', errorMessage: message });
      await expect(cms.fetchDocument('ja', 'guide')).resolves.toMatchObject({
        kind: 'upstream-unavailable',
        transportReason,
      });
    }
  });

  it('rejects malformed JSON and empty successful responses', async () => {
    for (const response of [new Response('{'), new Response(null, { status: 204 })]) {
      const { cms } = client({ kind: 'ok', status: response.status, response });
      await expect(cms.fetchDocument('ja', 'guide')).resolves.toMatchObject({
        kind: 'invalid-contract',
      });
    }
  });

  it('rejects bodies larger than one MiB', async () => {
    const response = new Response('x', { headers: { 'Content-Length': String(1024 * 1024 + 1) } });
    const { cms } = client({ kind: 'ok', status: 200, response });
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({
      kind: 'invalid-contract',
      reason: 'response_too_large',
      upstreamStatus: 200,
    });
  });

  it('rejects a representation for another locale or slug', async () => {
    for (const change of [{ locale: 'en' }, { slug: 'other' }]) {
      const { cms } = client(
        { kind: 'ok', status: 200, response: Response.json(indexPage) },
        {
          kind: 'ok',
          status: 200,
          response: Response.json({ ...payload, ...change }),
        },
      );
      await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({
        kind: 'invalid-contract',
        reason: 'schema_mismatch',
        upstreamStatus: 200,
      });
    }
  });

  it('enforces the one MiB limit while streaming without Content-Length', async () => {
    const { cms } = client({
      kind: 'ok',
      status: 200,
      response: new Response(new Uint8Array(1024 * 1024 + 1)),
    });
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({
      kind: 'invalid-contract',
      reason: 'response_too_large',
      upstreamStatus: 200,
    });
  });

  it('rejects unsafe slugs without calling Rails', async () => {
    const { cms, fetch } = client({ kind: 'ok', status: 200, response: Response.json(payload) });
    await expect(cms.fetchDocument('ja', '../secret')).resolves.toMatchObject({
      kind: 'upstream-protocol-error',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops walking the index after a few pages instead of crawling the collection', async () => {
    const missPage = (): RailsClientResult => ({
      kind: 'ok',
      status: 200,
      response: Response.json({
        data: [],
        page: { next_cursor: 'again', has_more: true },
      }),
    });
    const { cms, fetch } = client(missPage(), missPage(), missPage(), missPage());
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({
      kind: 'not-found',
      upstreamStatus: 404,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('maps a missing slug on the index to a generic not-found', async () => {
    const { cms } = client({
      kind: 'ok',
      status: 200,
      response: Response.json({ data: [], page: { next_cursor: null, has_more: false } }),
    });
    await expect(cms.fetchDocument('ja', 'guide')).resolves.toEqual({
      kind: 'not-found',
      upstreamStatus: 404,
    });
  });
});
