// @vitest-environment node
//
// See `worker.test.ts` for why: happy-dom's Fetch classes drop forbidden
// headers (e.g. Cookie) at construction time, unlike Node's (undici) or
// workerd's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blockedCoreResponse, classifyCorePath, dispatchToRails } from '../src/lib/core-dispatch';

const FRAME = 'app/core';
const ORIGIN = 'https://jp.umaxica.app';
const RAILS = 'https://rails.example';

/** `dispatchToRails` logs on every path; keep the reporter clean. */
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function railsReturns(response: Response) {
  return vi.fn().mockResolvedValue(response);
}

// The dispatcher calls the runtime's global `fetch`; stubbing it is the driver.
async function dispatch(request: Request, fetch: unknown) {
  vi.stubGlobal('fetch', fetch);
  return dispatchToRails(request, { RAILS_ORIGIN: RAILS }, true);
}

describe(`${FRAME} classifyCorePath`, () => {
  /*
   * The ownership table, including the paths Rails also serves and Edge
   * deliberately keeps. Those rows are the point of this table, not an
   * oversight — see the comment block in `core-dispatch.ts` and ADR 009.
   */
  it.each([
    // Rails-owned, prefix matched.
    ['/api/v0/session', 'rails'],
    ['/api/v0', 'rails'],
    ['/api/v0/health.json', 'next'],
    ['/api/v0/revision.json', 'next'],
    ['/web/v0/thing', 'rails'],
    ['/edge/v0/widgets', 'rails'],
    ['/oidc/callback', 'rails'],
    ['/oidc', 'rails'],
    // Rails-owned, exact matched.
    ['/sign/out', 'rails'],
    ['/sign/out/complete', 'rails'],
    ['/.well-known/jwks.json', 'rails'],
    ['/csp-violation-report', 'rails'],
    // Intentional Edge overrides of paths Rails also serves.
    ['/health', 'next'],
    ['/health/startups', 'next'],
    ['/health/livenesses', 'next'],
    ['/health/readinesses', 'next'],
    ['/health/liveness.json', 'blocked'],
    ['/health/readiness.json', 'blocked'],
    ['/health/startup.json', 'blocked'],
    ['/health/anything', 'blocked'],
    ['/robots.txt', 'next'],
    ['/sitemap.xml', 'next'],
    ['/configuration', 'next'],
    // Default, and a near-miss that must not be swept into a Rails prefix.
    ['/', 'next'],
    ['/rails-health', 'next'],
    ['/apiv0-lookalike', 'next'],
  ])('classifies %s as %s', (pathname, expected) => {
    expect(classifyCorePath(pathname)).toBe(expected);
  });

  it('keeps the exact /health path away from the /health/ block', () => {
    // The asymmetry that makes the unified health entry point possible: BLOCKED
    // is a raw `startsWith('/health/')`, so `/health` itself reaches Next.
    expect(classifyCorePath('/health')).toBe('next');
    expect(classifyCorePath('/health/startups')).toBe('next');
    expect(classifyCorePath('/health/livenesses')).toBe('next');
    expect(classifyCorePath('/health/readinesses')).toBe('next');
    expect(classifyCorePath('/health/')).toBe('blocked');
    expect(classifyCorePath('/health/liveness.json')).toBe('blocked');
  });
});

describe(`${FRAME} blockedCoreResponse`, () => {
  it('returns a bodyless 404 that is neither cached nor indexed', async () => {
    const response = blockedCoreResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate');
    await expect(response.text()).resolves.toBe('');
  });
});

describe(`${FRAME} dispatchToRails request construction`, () => {
  it('builds the Rails request against RAILS_ORIGIN, not the public hostname', async () => {
    const fetch = railsReturns(new Response('ok'));
    await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);

    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).origin).toBe(RAILS);
  });

  it('does not add an X-Forwarded-Host header', async () => {
    const fetch = railsReturns(new Response('ok'));
    await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);

    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('x-forwarded-host')).toBeNull();
  });

  it('preserves the path and query exactly', async () => {
    const fetch = railsReturns(new Response('ok'));
    await dispatch(new Request(`${ORIGIN}/edge/v0/widgets?limit=10&cursor=abc`), fetch);

    const request = fetch.mock.calls[0]?.[0] as Request;
    const url = new URL(request.url);
    expect(url.pathname).toBe('/edge/v0/widgets');
    expect(url.search).toBe('?limit=10&cursor=abc');
  });

  it('removes attacker-controlled proxy identity headers while preserving application headers', async () => {
    const fetch = railsReturns(new Response('ok'));
    const incoming = new Request(`${ORIGIN}/api/v0/x`, {
      headers: {
        authorization: 'Bearer token',
        cookie: 'session=abc',
        forwarded: 'for=203.0.113.10;host=evil.example;proto=http',
        origin: ORIGIN,
        referer: `${ORIGIN}/sign/in`,
        'x-csrf-token': 'csrf-token',
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
        'x-real-ip': '203.0.113.10',
      },
    });

    await dispatch(incoming, fetch);

    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('forwarded')).toBeNull();
    expect(request.headers.get('x-forwarded-for')).toBeNull();
    expect(request.headers.get('x-forwarded-host')).toBeNull();
    expect(request.headers.get('x-forwarded-proto')).toBeNull();
    expect(request.headers.get('x-real-ip')).toBeNull();
    // The browser's own credentials are forwarded on purpose — the opposite of
    // what `rails-client.ts` does, and the reason the two exist separately.
    expect(request.headers.get('authorization')).toBe('Bearer token');
    expect(request.headers.get('cookie')).toBe('session=abc');
    expect(request.headers.get('origin')).toBe(ORIGIN);
    expect(request.headers.get('referer')).toBe(`${ORIGIN}/sign/in`);
    expect(request.headers.get('x-csrf-token')).toBe('csrf-token');
  });

  it('carries an abort signal so a stalled upstream cannot hang the request', async () => {
    const fetch = railsReturns(new Response('ok'));
    await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);

    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal.aborted).toBe(false);
  });

  it('omits duplex for a bodyless GET request', async () => {
    const fetch = railsReturns(new Response('ok'));
    await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('forwards a non-GET body as a stream rather than buffering it', async () => {
    const fetch = railsReturns(new Response('{"id":1}', { status: 201 }));
    const incoming = new Request(`${ORIGIN}/api/v0/things`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=abc' },
      body: JSON.stringify({ name: 'thing' }),
    });

    const response = await dispatch(incoming, fetch);

    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('POST');
    expect(request.body).not.toBeNull();
    expect(request.headers.get('cookie')).toBe('session=abc');
    // Readable at the far end, which is what "not buffered here" has to mean.
    await expect(request.json()).resolves.toEqual({ name: 'thing' });
    expect(response.status).toBe(201);
  });
});

describe(`${FRAME} dispatchToRails passthrough`, () => {
  it.each([200, 201, 302, 404, 405, 422, 500])(
    'returns a Rails %i response unchanged',
    async (status) => {
      const railsHeaders = new Headers({ 'content-type': 'application/json' });
      railsHeaders.append('set-cookie', 'session=xyz; Path=/; HttpOnly');
      const fetch = railsReturns(
        new Response(status === 302 ? null : '{"from":"rails"}', {
          status,
          headers: railsHeaders,
        }),
      );

      const response = await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);

      expect(response.status).toBe(status);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('set-cookie')).toBe('session=xyz; Path=/; HttpOnly');
      if (status !== 302) {
        await expect(response.text()).resolves.toBe('{"from":"rails"}');
      }
    },
  );

  it('passes a plain Rails 500 through, without claiming it as a transport failure', async () => {
    const fetch = railsReturns(
      new Response('Rails 500 page', { status: 500, headers: { 'content-type': 'text/html' } }),
    );

    const response = await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('Rails 500 page');
  });

  it('passes a text/plain 500 through whatever its body says', async () => {
    // With no Workers VPC in the path, nothing answers on Rails' behalf: every
    // response that arrives is Rails' own and goes to the browser untouched.
    const fetch = railsReturns(
      new Response('ProxyError: connection_refused', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const response = await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('ProxyError: connection_refused');
  });
});

describe(`${FRAME} dispatchToRails upstream failure`, () => {
  const expectFailClosed = async (response: Response) => {
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    // This 503 is Edge's own document, not Rails', so it carries Edge's headers.
    // A body with no declared type is one the browser may sniff, and this one is
    // served from the application's origin.
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  };

  it.each([
    ['absent', {}],
    ['plain http to a public host', { RAILS_ORIGIN: 'http://rails.example' }],
    ['not a URL', { RAILS_ORIGIN: 'rails.example' }],
  ])('returns 503 when RAILS_ORIGIN is %s, and never calls fetch', async (_label, env) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const response = await dispatchToRails(new Request(`${ORIGIN}/api/v0/x`), env, true);

    await expectFailClosed(response);
    await expect(response.text()).resolves.toBe('Rails transport not configured');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 503 when fetch rejects', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:3000'));

    const response = await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);

    await expectFailClosed(response);
    await expect(response.text()).resolves.toBe('Rails upstream unavailable');
  });

  it('returns 503 when the request times out', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const fetch = vi.fn().mockRejectedValue(timeout);

    await expectFailClosed(await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch));
  });

  it('returns 503 when the request is aborted', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetch = vi.fn().mockRejectedValue(abort);

    await expectFailClosed(await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch));
  });

  it('returns 503 for a non-Error rejection', async () => {
    const fetch = vi.fn().mockRejectedValue('a string, not an Error');
    await expectFailClosed(await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch));
  });

  it('never retries after a rejection', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('boom'));
    await dispatch(
      new Request(`${ORIGIN}/api/v0/things`, { method: 'POST', body: '{"a":1}' }),
      fetch,
    );
    // A retried POST is a second mutation, not a second chance.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the transport error out of the 503 body', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.7:3000'));

    const response = await dispatch(new Request(`${ORIGIN}/api/v0/x`), fetch);
    const body = await response.text();

    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('10.0.0.7');
    expect(body).not.toContain('rails.example');
  });
});
