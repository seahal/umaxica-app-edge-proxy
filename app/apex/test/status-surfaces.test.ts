import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApexApp } from '../src/create-apex-app';

afterEach(() => vi.restoreAllMocks());

/*
 * What `/offline` and the 404 page actually serve is asserted over real HTTP in
 * `api/status-surfaces.hurl`. What remains here is the one status surface no
 * HTTP client can reach: the 500 page, which needs a route that throws.
 *
 * `app.request()` is the driver, not the subject — the assertion is on the
 * error boundary's choice of affordance, and reaching it requires injecting a
 * failing handler that the deployed app deliberately does not have.
 */
describe('apex 5xx surface', () => {
  it('uses the 5xx reload affordance on unexpected errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApexApp((routes) => {
      routes.get('/boom', () => {
        throw new Error('hidden');
      });
    });
    const response = await app.request('/boom', { headers: { 'accept-language': 'ja' } });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('再読み込み');
    expect(body).toContain('href="/about">このURLについて');

    const englishResponse = await app.request('/boom', {
      headers: { 'accept-language': 'en' },
    });
    expect(englishResponse.status).toBe(500);
    const englishBody = await englishResponse.text();
    expect(englishBody).toContain('Reload');
    expect(englishBody).toContain('href="/about">About this URL');
    expect(consoleError).toHaveBeenCalled();
  });
});

/*
 * The 4xx half of `errorPage`, which is a different call site from the 5xx one
 * above: `onError` turns an `HTTPException` into a status page directly, while
 * anything else becomes a 500. Only a route that raises one reaches it, so no
 * HTTP client can — `api/status-surfaces.hurl` covers the 404, but the 404 is
 * `app.notFound()` and goes through `notFoundPage`, never through here.
 *
 * Again `app.request()` is the driver and the injected route is the fixture;
 * the assertion is that a 4xx is localised on its own terms and offers no
 * reload. Reload is the 5xx affordance: retrying a rejected request unchanged
 * produces the same rejection, so offering it on a 4xx invites a loop.
 */
describe('apex 4xx surface', () => {
  it('localises the 4xx title and withholds the 5xx reload affordance', async () => {
    const app = createApexApp((routes) => {
      routes.get('/refused', () => {
        throw new HTTPException(400);
      });
    });

    const response = await app.request('/refused', { headers: { 'accept-language': 'ja' } });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain('リクエストを処理できませんでした');
    expect(body).toContain('HTTP 400');
    expect(body).not.toContain('再読み込み');
    expect(body).toContain('href="/about">このURLについて');

    const englishResponse = await app.request('/refused', {
      headers: { 'accept-language': 'en' },
    });
    expect(englishResponse.status).toBe(400);
    const englishBody = await englishResponse.text();
    expect(englishBody).toContain('The request could not be processed');
    expect(englishBody).not.toContain('Reload');
  });
});
