// @vitest-environment node
//
// This file exercises `Request`/`Headers` Cookie/Set-Cookie forwarding.
// happy-dom's Fetch implementation (the repo-wide default environment)
// enforces the browser forbidden-header-name list and silently drops a
// `Cookie` header at `Request` construction time, which would make this
// file's cookie-forwarding assertions pass or fail for the wrong reason.
// Node's own (undici) `Request`/`Headers` do not apply that browser-only
// restriction and match the real Cloudflare Workers (workerd) runtime this
// code actually runs on — this override does not touch `vitest.config.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkRateLimit, appFetch } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  appFetch: vi.fn(),
}));

// The application half, behind the one-function seam `worker.ts` names. Mocking
// it here is what keeps the real property testable: the dispatch boundary does
// not know which framework answers.
vi.mock('../src/lib/app-handler', () => ({
  default: { fetch: appFetch },
}));

vi.mock('../src/lib/health-request', () => ({
  sanitizeHealthRequest: (request: Request) => request,
}));

vi.mock('../src/lib/rate-limit', () => ({ checkRateLimit }));

import worker from '../src/worker';

// Rails is reached with the runtime's global `fetch`, so a Rails stand-in is a
// stubbed global plus a `RAILS_ORIGIN`; `afterEach` restores the real one.
function makeEnv(rails?: { fetch: (request: Request) => Promise<Response> }): CloudflareEnv {
  if (!rails) {
    return {} as CloudflareEnv;
  }
  vi.stubGlobal('fetch', rails.fetch);
  return { RAILS_ORIGIN: 'https://rails.example' } as unknown as CloudflareEnv;
}

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

describe('org/core worker.ts dispatch', () => {
  beforeEach(() => {
    // `dispatchToRails` logs on every path; keep the reporter clean.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    checkRateLimit.mockReset();
    appFetch.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('strips the Cookie header entirely before calling handler.fetch for an application-owned request', async () => {
    appFetch.mockResolvedValue(new Response('ok', { status: 200 }));

    const request = new Request('https://jp.umaxica.org/', {
      headers: { cookie: 'a=1; b=2' },
    });

    const response = await worker.fetch(request, makeEnv(), ctx);

    expect(appFetch).toHaveBeenCalledTimes(1);
    const forwardedRequest = appFetch.mock.calls[0]?.[0] as Request;
    expect(forwardedRequest.headers.get('cookie')).toBeNull();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('strips every Set-Cookie header from the application response before it reaches the caller', async () => {
    const appHeaders = new Headers();
    appHeaders.append('set-cookie', 'a=1; Path=/');
    appHeaders.append('set-cookie', 'b=2; Path=/');
    appFetch.mockResolvedValue(new Response('ok', { status: 200, headers: appHeaders }));

    const request = new Request('https://jp.umaxica.org/');
    const response = await worker.fetch(request, makeEnv(), ctx);

    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.getSetCookie?.() ?? []).toHaveLength(0);
  });

  it('dispatches a RAILS-owned request directly to Rails, never calling handler.fetch, preserving Cookie/CSRF/path/query', async () => {
    const railsFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    const request = new Request('https://jp.umaxica.org/api/v0/session?foo=bar', {
      headers: {
        cookie: 'session=abc',
        'x-csrf-token': 'token-123',
      },
    });

    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(appFetch).not.toHaveBeenCalled();
    expect(railsFetch).toHaveBeenCalledTimes(1);
    const railsRequest = railsFetch.mock.calls[0]?.[0] as Request;
    expect(railsRequest.headers.get('cookie')).toBe('session=abc');
    expect(railsRequest.headers.get('x-csrf-token')).toBe('token-123');
    const railsUrl = new URL(railsRequest.url);
    expect(railsUrl.pathname).toBe('/api/v0/session');
    expect(railsUrl.searchParams.get('foo')).toBe('bar');
    expect(response.status).toBe(200);
  });

  it('does not dispatch a rate-limited RAILS-owned request to Rails or the application', async () => {
    const railsFetch = vi.fn();
    checkRateLimit.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));

    const response = await worker.fetch(
      new Request('https://jp.umaxica.org/api/v0/session'),
      makeEnv({ fetch: railsFetch }),
      ctx,
    );

    expect(response.status).toBe(429);
    expect(railsFetch).not.toHaveBeenCalled();
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('does not send a rate-limited application-owned request to the application', async () => {
    // Checked before the application half is invoked at all.
    checkRateLimit.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));

    const response = await worker.fetch(new Request('https://jp.umaxica.org/'), makeEnv(), ctx);

    expect(response.status).toBe(429);
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('consults the limiter once per request, with the binding it was given', async () => {
    appFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const env = makeEnv();

    await worker.fetch(new Request('https://jp.umaxica.org/'), env, ctx);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit.mock.calls[0]?.[1]).toBe(env.RATE_LIMITER);
  });

  it.each([
    '/assets/index-abc123.js',
    '/assets/style-abc123.css',
    '/favicon.ico',
    '/health/startups',
    '/health/livenesses',
    '/api/v0/health.json',
  ])('exempts %s from the limiter', async (path) => {
    // `/assets/` is where Vite writes this frame's hashed output, and the
    // favicon is the one unhashed file a document references. An
    // image-optimisation route would be a real Worker route — a page with many
    // images could spend its whole budget on its own thumbnails — so it would
    // have to be exempted here too. This frame has none:
    // and it has no image-optimisation route at all.
    appFetch.mockResolvedValue(new Response('asset', { status: 200 }));

    const response = await worker.fetch(
      new Request(`https://jp.umaxica.org${path}`),
      makeEnv(),
      ctx,
    );

    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(appFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  /*
   * The three responses `worker.ts` produces ITSELF, rather than passing through
   * from Rails or the application.
   *
   * Each one used to be served bare — no CSP, no `X-Frame-Options`, no
   * `nosniff` — because `withSecurityHeaders` was applied inside
   * `app-handler.ts`, which none of them reach. The 429 is the one that matters
   * most: it is a complete HTML document an attacker can elicit on demand, so it
   * was the easiest page on this origin to frame.
   */
  describe('security headers on the responses the worker answers itself', () => {
    const expectHardened = (response: Response) => {
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    };

    it('headers the 404 for a blocked path', async () => {
      const response = await worker.fetch(
        new Request('https://jp.umaxica.org/health/live'),
        makeEnv(),
        ctx,
      );

      expect(response.status).toBe(404);
      expectHardened(response);
    });

    it('headers the 429 the limiter produces', async () => {
      checkRateLimit.mockResolvedValue(
        new Response('<!DOCTYPE html><html lang="ja"></html>', {
          status: 429,
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        }),
      );

      const response = await worker.fetch(new Request('https://jp.umaxica.org/'), makeEnv(), ctx);

      expect(response.status).toBe(429);
      expect(response.headers.get('content-type')).toBe('text/html; charset=UTF-8');
      expectHardened(response);
    });

    it('headers the 503 substituted when the Rails dispatch never reached Rails', async () => {
      checkRateLimit.mockResolvedValue(null);

      const response = await worker.fetch(
        new Request('https://jp.umaxica.org/api/v0/thing'),
        makeEnv(),
        ctx,
      );

      expect(response.status).toBe(503);
      expectHardened(response);
    });

    // The other half of the ADR 007 boundary: a response Rails actually authored
    // keeps its own headers, and Edge does not rewrite its policy.
    it('lets a real Rails response keep the headers Rails set', async () => {
      checkRateLimit.mockResolvedValue(null);
      const railsFetch = vi
        .fn()
        .mockResolvedValue(new Response('rails', { status: 200, headers: { 'X-Rails': '1' } }));

      const response = await worker.fetch(
        new Request('https://jp.umaxica.org/api/v0/thing'),
        makeEnv({ fetch: railsFetch }),
        ctx,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('x-rails')).toBe('1');
      expect(response.headers.get('content-security-policy')).toBeNull();
    });
  });

  /*
   * The authentication paths are counted against a second, much smaller budget
   * IN ADDITION to the general one — ASVS V2.2.1. Sharing one limiter made an
   * OIDC endpoint exactly as cheap to hammer as a static page.
   */
  describe('authentication-path rate limiting', () => {
    const authEnv = () => {
      const env = makeEnv({ fetch: vi.fn().mockResolvedValue(new Response('rails')) });
      return { ...env, AUTH_RATE_LIMITER: { limit: vi.fn() } } as unknown as CloudflareEnv;
    };

    it('consults both limiters for an /oidc/ path', async () => {
      checkRateLimit.mockResolvedValue(null);

      await worker.fetch(new Request('https://jp.umaxica.org/oidc/authorize'), authEnv(), ctx);

      expect(checkRateLimit).toHaveBeenCalledTimes(2);
    });

    it('consults only the general limiter for an ordinary page', async () => {
      checkRateLimit.mockResolvedValue(null);
      appFetch.mockResolvedValue(new Response('ok'));

      await worker.fetch(new Request('https://jp.umaxica.org/about'), authEnv(), ctx);

      expect(checkRateLimit).toHaveBeenCalledTimes(1);
    });

    it('answers 429 from the auth limiter without ever dispatching to Rails', async () => {
      const railsFetch = vi.fn().mockResolvedValue(new Response('rails'));
      const env = {
        ...makeEnv({ fetch: railsFetch }),
        AUTH_RATE_LIMITER: { limit: vi.fn() },
      } as unknown as CloudflareEnv;

      checkRateLimit
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(new Response('too many', { status: 429 }));

      const response = await worker.fetch(new Request('https://jp.umaxica.org/sign/out'), env, ctx);

      expect(response.status).toBe(429);
      expect(railsFetch).not.toHaveBeenCalled();
    });
  });

  it('does not consult the limiter for a blocked path', async () => {
    // A blocked path reaches no application code either way, so a limiter call
    // would be spent for nothing.
    const response = await worker.fetch(
      new Request('https://jp.umaxica.org/health/liveness.json'),
      makeEnv(),
      ctx,
    );

    expect(response.status).toBe(404);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('sends /oidc/callback straight to Rails with the query string unchanged and passes through Set-Cookie/redirect unchanged', async () => {
    const railsHeaders = new Headers({
      location: 'https://jp.umaxica.org/',
      'set-cookie': 'sess=xyz',
    });
    const railsFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: railsHeaders }));

    const request = new Request('https://jp.umaxica.org/oidc/callback?code=abc&state=def');
    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(appFetch).not.toHaveBeenCalled();
    const railsRequest = railsFetch.mock.calls[0]?.[0] as Request;
    const railsUrl = new URL(railsRequest.url);
    expect(railsUrl.searchParams.get('code')).toBe('abc');
    expect(railsUrl.searchParams.get('state')).toBe('def');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://jp.umaxica.org/');
    expect(response.headers.get('set-cookie')).toBe('sess=xyz');
  });

  it('returns a RAILS-owned 404 unchanged, without falling through to the application', async () => {
    const railsFetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const request = new Request('https://jp.umaxica.org/api/v0/does-not-exist');

    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(appFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });

  it('returns a RAILS-owned 405 unchanged, without falling through to the application', async () => {
    const railsFetch = vi
      .fn()
      .mockResolvedValue(new Response('method not allowed', { status: 405 }));
    const request = new Request('https://jp.umaxica.org/web/v0/thing', { method: 'DELETE' });

    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(appFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(405);
  });

  it('keeps an application 404 an application 404, without retrying against Rails', async () => {
    const railsFetch = vi.fn();
    appFetch.mockResolvedValue(new Response('not found', { status: 404 }));

    const request = new Request('https://jp.umaxica.org/this-page-does-not-exist');
    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(railsFetch).not.toHaveBeenCalled();
    expect(appFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });

  it('blocks /health/liveness.json from reaching either Rails or the application', async () => {
    const railsFetch = vi.fn();
    const request = new Request('https://jp.umaxica.org/health/liveness.json');

    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(railsFetch).not.toHaveBeenCalled();
    expect(appFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });

  it.each(['/health', '/health/startups', '/health/livenesses', '/health/readinesses'])(
    'leaves %s reachable through the application (not blocked)',
    async (path) => {
      appFetch.mockResolvedValue(new Response('ok\n', { status: 200 }));
      const request = new Request(`https://jp.umaxica.org${path}`);

      const response = await worker.fetch(request, makeEnv(), ctx);

      expect(appFetch).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    },
  );

  /*
   * The exempt set is the three probes that cannot fail and cannot reach a
   * downstream hop. These five look adjacent to it and are metered anyway,
   * which is the half of the rule a list of exemptions cannot state:
   *
   *   /health, /health/readinesses     fetch Rails at RAILS_ORIGIN
   *                                    (`src/routes/health.ts`,
   *                                    `src/routes/health.readinesses.ts`). An
   *                                    exemption here is an unauthenticated,
   *                                    uncounted path into the Rails origin.
   *   /revision, /api/v0/revision.json deployment metadata, not probes.
   *   /                                the ordinary case, pinned alongside them
   *                                    so a regression that exempts everything
   *                                    fails here rather than silently passing.
   */
  it.each(['/health', '/health/readinesses', '/revision', '/api/v0/revision.json', '/'])(
    'meters %s',
    async (path) => {
      checkRateLimit.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));

      const response = await worker.fetch(
        new Request(`https://jp.umaxica.org${path}`),
        makeEnv(),
        ctx,
      );

      expect(checkRateLimit).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(429);
      expect(appFetch).not.toHaveBeenCalled();
    },
  );

  it('does not exempt lookalike health paths from the limiter', async () => {
    checkRateLimit.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));

    const response = await worker.fetch(
      new Request('https://jp.umaxica.org/healthiness'),
      makeEnv(),
      ctx,
    );

    expect(response.status).toBe(429);
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('forwards a non-GET RAILS-owned request with a body without corruption or buffering', async () => {
    const railsFetch = vi.fn().mockResolvedValue(new Response('created', { status: 201 }));
    const request = new Request('https://jp.umaxica.org/api/v0/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(appFetch).not.toHaveBeenCalled();
    const railsRequest = railsFetch.mock.calls[0]?.[0] as Request;
    expect(railsRequest.method).toBe('POST');
    expect(railsRequest.body).not.toBeNull();
    await expect(railsRequest.json()).resolves.toEqual({ hello: 'world' });
    expect(response.status).toBe(201);
  });

  it('fails closed with 503 when no Rails origin is configured, without falling back to the application', async () => {
    const request = new Request('https://jp.umaxica.org/api/v0/session');

    const response = await worker.fetch(request, makeEnv(undefined), ctx);

    expect(appFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
  });

  it.each([
    [
      'the Rails fetch rejects',
      () => vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:3000')),
    ],
    [
      'the request times out',
      () =>
        vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    ],
  ])('answers 503 and never reaches the application when %s', async (_label, makeRailsFetch) => {
    const railsFetch = makeRailsFetch();
    const request = new Request('https://jp.umaxica.org/api/v0/session', {
      method: 'POST',
      headers: { cookie: 'session=abc' },
      body: '{"a":1}',
    });

    const response = await worker.fetch(request, makeEnv({ fetch: railsFetch }), ctx);

    expect(response.status).toBe(503);
    // A Rails or transport failure is never an invitation to try the application, and
    // never an invitation to try Rails a second time.
    expect(appFetch).not.toHaveBeenCalled();
    expect(railsFetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.text()).resolves.not.toContain('ECONNREFUSED');
  });

  it('keeps a Rails 500 of its own making distinct from a transport failure', async () => {
    const railsFetch = vi
      .fn()
      .mockResolvedValue(
        new Response('rails error page', { status: 500, headers: { 'content-type': 'text/html' } }),
      );

    const response = await worker.fetch(
      new Request('https://jp.umaxica.org/web/v0/thing'),
      makeEnv({ fetch: railsFetch }),
      ctx,
    );

    expect(appFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('rails error page');
  });
});
