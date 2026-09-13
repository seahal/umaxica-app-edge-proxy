import { describe, expect, it, vi } from 'vitest';

import app from '../../src/index';

/*
 * Security headers on rejected requests.
 *
 * The 404 and CSRF-403 cases moved to `api/security-headers.hurl` and
 * `api/csrf.hurl`, where they are asserted against a real response. The two
 * that remain cannot be provoked over HTTP: one needs `toISOString` to throw so
 * the error boundary runs, the other needs a `RATE_LIMITER` binding that
 * refuses. Both exist to prove the same thing — that
 * `app.use('*', apexSecurityHeaders)` is ahead of every path that can short-
 * circuit a request, not just the ones that return a document.
 */
describe('security headers on short-circuited requests', () => {
  it('keeps them on a request the error boundary catches', async () => {
    const isoSpy = vi.spyOn(Date.prototype, 'getUTCFullYear').mockImplementation(() => {
      throw new Error('ISO String error');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request('/about', {}, {});

    expect(res.status).toBe(500);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    await expect(res.text()).resolves.toContain('HTTP 500');
    expect(consoleSpy).toHaveBeenCalledWith('Unhandled apex error', {
      error: 'Error',
      method: 'GET',
      path: '/about',
    });

    isoSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('keeps them on a rate-limit rejection', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const res = await app.request('/about', {}, { RATE_LIMITER: { limit } });

    expect(res.status).toBe(429);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
});
