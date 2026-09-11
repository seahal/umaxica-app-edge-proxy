// First-touch rate limiting for this content unit (adr/010).
//
// No binding is a pass-through, an allowance is a pass-through, and a refusal is
// the bare 429 document. The limiter is a parameter rather than a module-scope
// `env` read, so `src/request-handler.ts` supplies it and this file does not
// need `cloudflare:workers` at all.

import { describe, expect, it, vi } from 'vitest';

import { checkRateLimit } from '../../src/lib/rate-limit';
import { BRAND_TITLE } from '../../src/lib/title';

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', { headers });
}

describe('rate limiting', () => {
  it('passes the request through when no RATE_LIMITER binding is present', async () => {
    await expect(checkRateLimit(request(), undefined)).resolves.toBeNull();
  });

  it('passes the request through when the rate limiter allows it', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });

    await expect(checkRateLimit(request(), { limit })).resolves.toBeNull();
  });

  it('answers 429 with a no-store HTML document when the limiter refuses', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });

    const response = await checkRateLimit(request(), { limit });

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(response?.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
    await expect(response?.text()).resolves.toContain('HTTP 429');
  });

  it('titles the 429 document for this brand tier', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });

    const response = await checkRateLimit(request(), { limit });

    await expect(response?.text()).resolves.toContain(
      `<title>リクエストを処理できませんでした — ${BRAND_TITLE}</title>`,
    );
  });

  it('keys the limiter on the Cloudflare client IP', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });

    await checkRateLimit(request({ 'cf-connecting-ip': '203.0.113.9' }), { limit });

    expect(limit).toHaveBeenNthCalledWith(1, { key: '203.0.113.9' });
  });

  // A missing `CF-Connecting-IP` must not put every such request into one shared
  // bucket: that bucket is a bypass for the clients inside it and a denial of
  // service against each other, since any one of them can spend it for all.
  it('falls back to a per-path key, not one bucket shared by every caller', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });

    await checkRateLimit(request(), { limit });

    expect(limit).toHaveBeenCalledWith({ key: 'no-ip:/' });
  });

  it('keeps two header-less requests to different paths in different buckets', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });

    await checkRateLimit(new Request('http://localhost/about'), { limit });
    await checkRateLimit(new Request('http://localhost/'), { limit });

    expect(limit).toHaveBeenNthCalledWith(1, { key: 'no-ip:/about' });
    expect(limit).toHaveBeenNthCalledWith(2, { key: 'no-ip:/' });
  });

  // An empty header value is as unattributable as an absent one.
  it('treats an empty cf-connecting-ip as absent', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });

    await checkRateLimit(request({ 'cf-connecting-ip': '' }), { limit });

    expect(limit).toHaveBeenCalledWith({ key: 'no-ip:/' });
  });

  // The 429 is a bare document on purpose: `src/middleware.ts` is what puts the
  // security headers on it, in the same place it headers every other response
  // this unit answers.
  it('returns the 429 without security headers, leaving them to the middleware', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });

    const response = await checkRateLimit(request(), { limit });

    expect(response?.headers.get('Content-Security-Policy')).toBeNull();
    expect(response?.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
  });
});
