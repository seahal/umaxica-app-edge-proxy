import { afterEach, describe, expect, it, vi } from 'vitest';

import { PUBLISHING_STATUS_HEADER } from '../src/lib/publishing-status';
import { handleRequest } from '../src/request-handler';
import { resetEnv, setEnv } from './__mocks__/cloudflare-workers';

/*
 * The request boundary: what happens around the router on every request.
 *
 * `src/server.ts` supplies TanStack's fetch handler and cannot be imported here
 * — `@tanstack/react-start/server-entry` resolves only in the Worker build — so
 * the handler is passed in (`app.request()`-style driving, allowed because a
 * rate limiter that refuses and a router that answers a Publishing failure are
 * not states an HTTP client can produce on demand).
 */
afterEach(resetEnv);

const ok = () => Promise.resolve(new Response('<html></html>', { status: 200 }));
const refusing = () => ({ limit: vi.fn().mockResolvedValue({ success: false }) });

describe('request handler', () => {
  it('adds the security headers to whatever the router returns, including a 404', async () => {
    const response = await handleRequest(new Request('http://localhost/ja/'), ok, true);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");

    const notFound = () => Promise.resolve(new Response('<html></html>', { status: 404 }));
    const missing = await handleRequest(new Request('http://localhost/nope'), notFound, true);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('answers 429 without running the router, and hardens the 429 too', async () => {
    const limiter = refusing();
    setEnv({ RATE_LIMITER: limiter });
    const router = vi.fn(ok);

    const response = await handleRequest(new Request('http://localhost/ja/entries/'), router, true);

    expect(response.status).toBe(429);
    expect(router).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('never meters the three constant probes, and does meter the Rails-backed ones', async () => {
    const limiter = refusing();
    setEnv({ RATE_LIMITER: limiter });

    for (const path of ['/health/startups', '/health/livenesses', '/api/v0/health.json']) {
      const response = await handleRequest(new Request(`http://localhost${path}`), ok, true);
      expect(response.status, path).toBe(200);
    }
    expect(limiter.limit).not.toHaveBeenCalled();

    for (const path of ['/health', '/health/readinesses', '/revision']) {
      const response = await handleRequest(new Request(`http://localhost${path}`), ok, true);
      expect(response.status, path).toBe(429);
    }
  });

  it('runs the router when the limiter allows the request', async () => {
    setEnv({ RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) } });
    const router = vi.fn(ok);

    const response = await handleRequest(new Request('http://localhost/'), router, true);

    expect(router).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it('moves a Publishing failure status onto the status line and never leaks the header', async () => {
    for (const status of [502, 503, 504]) {
      const router = () =>
        Promise.resolve(
          new Response('<html></html>', {
            status: 200,
            headers: { [PUBLISHING_STATUS_HEADER]: String(status), 'Cache-Control': 'no-store' },
          }),
        );
      const response = await handleRequest(
        new Request('http://localhost/ja/entries/'),
        router,
        true,
      );
      expect(response.status).toBe(status);
      expect(response.headers.has(PUBLISHING_STATUS_HEADER)).toBe(false);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    }
  });

  it('names one nonce per production request and none in development', async () => {
    const nonceOf = (response: Response) =>
      /'nonce-([^']+)'/u.exec(response.headers.get('Content-Security-Policy') ?? '')?.[1];

    const first = await handleRequest(new Request('http://localhost/'), ok, true);
    const second = await handleRequest(new Request('http://localhost/'), ok, true);
    expect(nonceOf(first)).toBeDefined();
    expect(nonceOf(first)).not.toBe(nonceOf(second));

    const development = await handleRequest(new Request('http://localhost/'), ok, false);
    expect(development.headers.get('Content-Security-Policy')).not.toContain('nonce-');
    expect(development.headers.get('Content-Security-Policy')).toContain("'unsafe-eval'");
  });
});
