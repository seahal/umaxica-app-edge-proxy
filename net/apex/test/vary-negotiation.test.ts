import { describe, expect, it } from 'vitest';

import { createApexApp } from '../src/create-apex-app';

/*
 * `Vary` is appended to, never assigned.
 *
 * Which documents carry `Cookie, Accept-Language` and which do not is asserted
 * against real responses in `api/theme.hurl`. What stays here is the half no
 * HTTP client can reach: nothing in the deployed app sets a `Vary` of its own
 * for this middleware to preserve, so proving it preserves one needs a route
 * that does — which is why this file injects one. `app.request()` is the
 * driver; the subject is what happened to the header the route set.
 *
 * It is worth a test of its own because the first version of the middleware
 * assigned the header and silently dropped exactly this.
 */
describe('vary on negotiation', () => {
  const appWith = (vary?: string) =>
    createApexApp((routes) => {
      routes.get('/upstream', (c) => {
        if (vary) c.header('Vary', vary);
        return c.html('<!doctype html><html lang="ja"><body>ok</body></html>');
      });
    });

  it('keeps a directive another layer already set', async () => {
    const response = await appWith('Origin').request('/upstream');
    const value = response.headers.get('vary') ?? '';

    expect(value).toContain('Origin');
    expect(value).toContain('Cookie');
    expect(value).toContain('Accept-Language');
  });

  it('states the two axes on its own when nothing else has', async () => {
    const response = await appWith().request('/upstream');

    expect(response.headers.get('vary')).toBe('Cookie, Accept-Language');
  });
});
