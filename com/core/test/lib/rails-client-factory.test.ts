import { describe, it, expect, vi } from 'vitest';

import { createRailsClient, type RailsFetcher } from '../../src/lib/rails-client';

function makeBinding(response: Response | Error) {
  const fetch = vi.fn<RailsFetcher['fetch']>(() => {
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve(response);
  });
  return { fetch } satisfies RailsFetcher;
}

describe('com/core rails client factory', () => {
  it('always requests against the fixed hostname regardless of caller input', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/health');

    const [requestUrl] = binding.fetch.mock.calls[0] as [string, RequestInit];
    expect(new URL(requestUrl).hostname).toBe('core.com.localhost');
    expect(new URL(requestUrl).port).toBe('3000');
  });

  it('rejects an absolute URL from the caller instead of redirecting the origin', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    const result = await client.fetch('http://evil.example.com/steal');

    expect(result.kind).toBe('invalid-path');
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it('rejects a protocol-relative path', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    const result = await client.fetch('//evil.example.com/steal');

    expect(result.kind).toBe('invalid-path');
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it('combines a relative path with the fixed origin correctly', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/widgets?limit=10');

    const [requestUrl] = binding.fetch.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe('http://core.com.localhost:3000/edge/v0/widgets?limit=10');
  });

  it.each(['', 'no-leading-slash', '/\\evil.com', '/path\0withnull'])(
    'rejects malformed path %j',
    async (path) => {
      const binding = makeBinding(new Response('ok', { status: 200 }));
      const client = createRailsClient(binding, 'http://core.com.localhost:3000');

      const result = await client.fetch(path);

      expect(result.kind).toBe('invalid-path');
      expect(binding.fetch).not.toHaveBeenCalled();
    },
  );

  it('supplies a bounded timeout signal on every request', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/health');

    const [, init] = binding.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not forward browser cookies by default', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/health', { headers: { cookie: 'session=secret' } });

    const [, init] = binding.fetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has('cookie')).toBe(false);
  });

  it('does not forward Authorization by default', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/health', { headers: { authorization: 'Bearer secret' } });

    const [, init] = binding.fetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has('authorization')).toBe(false);
  });

  it('strips Cloudflare Access headers even if a caller supplies them', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/health', {
      headers: {
        'cf-access-client-id': 'id',
        'cf-access-client-secret': 'secret',
      },
    });

    const [, init] = binding.fetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has('cf-access-client-id')).toBe(false);
    expect(headers.has('cf-access-client-secret')).toBe(false);
  });

  it('produces a typed http-error result for non-2xx responses', async () => {
    const binding = makeBinding(new Response('nope', { status: 500 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    const result = await client.fetch('/edge/v0/health');

    expect(result.kind).toBe('http-error');
    if (result.kind === 'http-error') {
      expect(result.status).toBe(500);
    }
  });

  it('still reports a plain 500 from Rails as an http-error', async () => {
    const binding = makeBinding(
      new Response('boom', { status: 500, headers: { 'content-type': 'text/html' } }),
    );
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    const result = await client.fetch('/api/v0/health.json');

    expect(result.kind).toBe('http-error');
  });

  it('produces a bounded ok result for successful responses', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    const result = await client.fetch('/edge/v0/health');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.status).toBe(200);
    }
  });

  it('produces an unreachable result when the binding fetch rejects', async () => {
    const binding = makeBinding(new Error('network down'));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    const result = await client.fetch('/edge/v0/health');

    expect(result.kind).toBe('unreachable');
  });

  it('never requests caching', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/health');

    const [, init] = binding.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe('no-store');
  });
  it('forwards method and body when the caller supplies them', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/widgets', { method: 'POST', body: 'payload' });

    const [, init] = binding.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('payload');
  });

  it('omits method and body entirely when the caller supplies neither', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/edge/v0/health');

    const [, init] = binding.fetch.mock.calls[0] as [string, RequestInit];
    expect('method' in init).toBe(false);
    expect('body' in init).toBe(false);
  });
  // Rails routes on the path exactly as given — there is no /{frame}/{brand}
  // prefix on either transport. Asserted rather than assumed, because a prefix
  // reintroduced here would produce 404s that read as a Rails outage.
  it('sends the path through unchanged, with no frame prefix', async () => {
    const binding = makeBinding(new Response('ok', { status: 200 }));
    const client = createRailsClient(binding, 'http://core.com.localhost:3000');

    await client.fetch('/api/v0/health.json');

    const [requestUrl] = binding.fetch.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe('http://core.com.localhost:3000/api/v0/health.json');
  });
});
