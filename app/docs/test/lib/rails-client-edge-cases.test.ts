import { describe, expect, it, vi } from 'vitest';

import { createRailsClient } from '../../src/lib/rails-client';

describe('Rails client edge cases', () => {
  it('rejects every dangerous relative-path form before fetching', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('ok')));
    const client = createRailsClient({ fetch }, 'http://core.example.localhost:3000');

    await expect(client.fetch('/nested://scheme')).resolves.toMatchObject({
      kind: 'invalid-path',
      reason: 'path must not embed a scheme',
    });
    await expect(client.fetch('/with\u007fcontrol')).resolves.toMatchObject({
      kind: 'invalid-path',
      reason: 'path must not contain control characters',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an abort timeout as timeout, not unreachable', async () => {
    const client = createRailsClient(
      {
        fetch: vi.fn(() =>
          Promise.reject(new DOMException('The operation was aborted.', 'TimeoutError')),
        ),
      },
      'http://core.example.localhost:3000',
    );

    await expect(client.fetch('/health')).resolves.toEqual({ kind: 'timeout' });
  });

  it('reports non-Error transport failures without losing their message', async () => {
    const client = createRailsClient(
      { fetch: vi.fn(() => Promise.reject('socket unavailable')) },
      'http://core.example.localhost:3000',
    );

    await expect(client.fetch('/health')).resolves.toEqual({
      kind: 'unreachable',
      errorMessage: 'socket unavailable',
    });
  });

  it('preserves an HTTP error when its plain-text body cannot be inspected', async () => {
    const response = {
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'text/plain' }),
      clone: () => ({ text: () => Promise.reject(new Error('body unavailable')) }),
    } as unknown as Response;
    const client = createRailsClient(
      { fetch: vi.fn(() => Promise.resolve(response)) },
      'http://core.example.localhost:3000',
    );

    await expect(client.fetch('/health')).resolves.toMatchObject({
      kind: 'http-error',
      status: 500,
    });
  });

  it('does not inspect ordinary non-500 HTTP errors as VPC proxy failures', async () => {
    const response = new Response('missing', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
    const client = createRailsClient(
      { fetch: vi.fn(() => Promise.resolve(response)) },
      'http://core.example.localhost:3000',
    );
    await expect(client.fetch('/missing')).resolves.toMatchObject({
      kind: 'http-error',
      status: 404,
    });
  });

  it('strips caller credentials and adds none of its own', async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('ok')),
    );
    const client = createRailsClient({ fetch }, 'http://core.example.localhost:3000');

    await client.fetch('/health', {
      headers: { authorization: 'Bearer caller', cookie: 'session=1', accept: 'application/json' },
    });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
  });

  it('fails closed when the configured origin is not normalized', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('ok')));
    const client = createRailsClient({ fetch }, 'http://core.example.localhost:3000/');

    await expect(client.fetch('/health')).resolves.toEqual({
      kind: 'invalid-path',
      reason: 'path resolved outside the fixed origin',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
