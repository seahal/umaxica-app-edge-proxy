import { afterEach, describe, expect, it, vi } from 'vitest';

import app from '../src/index';
import * as runtimeHealth from '../src/runtime-health';

afterEach(() => {
  vi.restoreAllMocks();
});

/*
 * Probe status, content-type and cache headers are also pinned in `api/health.hurl`.
 * This file covers the cases an HTTP client cannot produce: a mocked readiness
 * failure, and a mocked downstream fetch that must not take liveness down.
 * `app.request()` is the driver, never the subject.
 */

describe('runtime health probes', () => {
  it('answers 200 text/plain on the four probe URLs', async () => {
    for (const path of [
      '/health',
      '/health/startups',
      '/health/livenesses',
      '/health/readinesses',
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.text();
      expect(body).not.toContain('{');
      expect(body).not.toContain('<html');
    }
  });

  it('answers 404 HTML at /health.html and /health.json', async () => {
    const health = await app.request('/health', { headers: { accept: 'application/json' } });
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    await expect(health.text()).resolves.not.toContain('{');

    for (const path of ['/health.html', '/health.json']) {
      const missing = await app.request(path, {
        headers: { accept: 'application/json' },
      });
      expect(missing.status, path).toBe(404);
      expect(missing.headers.get('content-type'), path).toBe('text/html; charset=UTF-8');
      const body = await missing.text();
      expect(body, path).not.toMatch(/^\s*\{/u);
    }
  });

  it('does not redirect and does not require authentication', async () => {
    const response = await app.request('/health/livenesses');
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('answers 503 when readiness fails, without failing liveness', async () => {
    vi.spyOn(runtimeHealth.runtimeProbes, 'checkReadiness').mockReturnValue('error');

    const ready = await app.request('/health/readinesses');
    expect(ready.status).toBe(503);
    await expect(ready.text()).resolves.toBe('error\n');

    const live = await app.request('/health/livenesses');
    expect(live.status).toBe(200);
    await expect(live.text()).resolves.toBe('ok\n');

    // The aggregate is the only place the three statuses are combined, and it
    // must not report `ok` while one of them is `error`. A mocked probe is the
    // only way to reach that combination — every probe answers `ok` from a live
    // isolate, so no HTTP client can produce this.
    const aggregate = await app.request('/health');
    expect(aggregate.status).toBe(503);
    await expect(aggregate.text()).resolves.toBe(
      'status: error\nstartup: ok\nliveness: ok\nreadiness: error\n',
    );
  });

  it('does not treat a downstream fetch failure as a liveness failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('upstream down'));

    const response = await app.request('/health/livenesses');

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe('ok\n');
  });

  it('answers Edge self-health JSON without cookies, Rails, or revision', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const response = await app.request('/api/v0/health.json', {
      headers: { 'accept-language': 'ja' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      status: 'pass',
      checks: {
        startup: { status: 'pass' },
        liveness: { status: 'pass' },
        readiness: { status: 'pass' },
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
