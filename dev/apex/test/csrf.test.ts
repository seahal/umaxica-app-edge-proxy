import { describe, expect, it } from 'vitest';

import { createApexApp } from '../src/create-apex-app';
import { isAllowedApexOrigin } from '../src/csrf';

/*
 * Two things, split by what can observe them.
 *
 * The origin predicate is pure, so it is asserted directly. Whether `apexCsrf`
 * is mounted at all, and whether it really refuses a cross-origin POST, is
 * asserted over real HTTP in `api/csrf.hurl` — the two tests that used to live
 * here could not tell: one mounted the middleware on a throwaway `new Hono()`
 * (so it stayed green if `create-apex-app.ts` dropped it) and the other invoked
 * the middleware against a hand-built fake context, which asserted the shape of
 * the mock as much as the behaviour of the code.
 *
 * What is left over is the `EDGE_ENV` gate at the bottom of this file: a
 * Workers binding decides the policy, and no HTTP client can set one.
 */
const production = { allowLocalhost: false };
const development = { allowLocalhost: true };

/** This unit's own origins, named once for the environment-gate cases below. */
const PRODUCTION_ORIGIN = 'https://umaxica.dev';
const LOCAL_ORIGIN = 'http://dev.localhost:5501';

describe('apex CSRF config', () => {
  it("accepts this unit's own apex origin and nothing adjacent to it", () => {
    expect(isAllowedApexOrigin('https://umaxica.dev', production)).toBe(true);
    expect(isAllowedApexOrigin('http://umaxica.dev', production)).toBe(false);
    expect(isAllowedApexOrigin('https://umaxica.dev.evil.example', production)).toBe(false);
    expect(isAllowedApexOrigin('https://evil.example', production)).toBe(false);
    expect(isAllowedApexOrigin(undefined, production)).toBe(false);
  });

  /*
   * The sibling apexes are separate sites. This predicate was shared verbatim
   * by all five units and accepted every one of them, so a form on one UMAXICA
   * domain could post to another; nothing in this unit needs that.
   */
  it('rejects the sibling apex domains', () => {
    expect(isAllowedApexOrigin('https://umaxica.com', production)).toBe(false);
    expect(isAllowedApexOrigin('https://umaxica.org', production)).toBe(false);
  });

  it('accepts the local dev origin only off production', () => {
    expect(isAllowedApexOrigin('http://dev.localhost:3333', development)).toBe(true);
    expect(isAllowedApexOrigin('http://dev.localhost', development)).toBe(true);
    expect(isAllowedApexOrigin('http://dev.localhost:3333', production)).toBe(false);
    expect(isAllowedApexOrigin('http://com.localhost:3333', development)).toBe(false);
  });

  /*
   * A preview of this worker is this worker, so it stays allowed on production
   * too — `preview_urls` is on at the top level of wrangler.jsonc. What it may
   * not do is let any workers.dev host in: the worker name is pinned and only
   * the account label is open.
   */
  it('accepts previews of this worker on workers.dev', () => {
    expect(
      isAllowedApexOrigin('https://umaxica-apps-edge-dev-apex.acct.workers.dev', production),
    ).toBe(true);
    expect(
      isAllowedApexOrigin('https://abc123-umaxica-apps-edge-dev-apex.acct.workers.dev', production),
    ).toBe(true);
    expect(
      isAllowedApexOrigin('http://umaxica-apps-edge-dev-apex.acct.workers.dev', production),
    ).toBe(false);
    expect(
      isAllowedApexOrigin('https://umaxica-apps-edge-com-apex.acct.workers.dev', production),
    ).toBe(false);
    expect(isAllowedApexOrigin('https://preview.attacker.workers.dev', production)).toBe(false);
    expect(isAllowedApexOrigin('https://workers.dev', production)).toBe(false);
  });
});

/*
 * The production gate, driven through the real app.
 *
 * `allowLocalhost` is not a constant: `apexCsrf` derives it from the `EDGE_ENV`
 * binding on every request. No HTTP client can set a Workers binding, so
 * `api/csrf.hurl` can only ever exercise whichever tier it happens to be
 * running against — it says as much, and leaves "on production this origin is
 * refused" as a claim nothing checks. That claim is what these assert.
 *
 * `createApexApp` rather than a throwaway `new Hono()`, for the reason recorded
 * above: mounting `apexCsrf` locally would prove the middleware works and
 * nothing about whether the app still installs it. `app.request()` is the
 * driver, never the subject — the status is read only to tell "refused by CSRF"
 * (403) apart from "cleared CSRF, then matched no route" (404).
 */
describe('apex CSRF environment gate', () => {
  const postFrom = (origin: string, env?: { EDGE_ENV?: string }) => {
    const request = new Request('http://dev.localhost/about', { method: 'POST' });
    /*
     * Set on the built request, not passed to the constructor. `Origin` is a
     * forbidden header name — which is the whole reason the value can be
     * trusted — so happy-dom drops it exactly as a browser would, and a request
     * built with it in the init arrives with no `Origin` at all. That reads as a
     * refusal for every origin and would have made these cases pass for the
     * wrong reason.
     */
    request.headers.set('Origin', origin);
    return createApexApp(() => undefined).request(request, undefined, env);
  };

  it('refuses the local dev origin once EDGE_ENV says production', async () => {
    expect((await postFrom(LOCAL_ORIGIN, { EDGE_ENV: 'production' })).status).toBe(403);
  });

  /*
   * Every value that is not literally `production` — a missing binding and an
   * absent `c.env` included — leaves the local origin allowed, which is what
   * makes `pnpm run dev` and the test suite work at all.
   */
  it('allows the local dev origin on every other tier', async () => {
    expect((await postFrom(LOCAL_ORIGIN, { EDGE_ENV: 'development' })).status).toBe(404);
    expect((await postFrom(LOCAL_ORIGIN, {})).status).toBe(404);
    expect((await postFrom(LOCAL_ORIGIN)).status).toBe(404);
  });

  // The gate moves `allowLocalhost` and nothing else: a foreign origin is
  // refused on every tier, and this unit's own apex is accepted on every tier.
  it('leaves the rest of the allowlist unmoved by the tier', async () => {
    expect((await postFrom('https://evil.example', { EDGE_ENV: 'production' })).status).toBe(403);
    expect((await postFrom('https://evil.example', { EDGE_ENV: 'development' })).status).toBe(403);
    expect((await postFrom(PRODUCTION_ORIGIN, { EDGE_ENV: 'production' })).status).toBe(404);
    expect((await postFrom(PRODUCTION_ORIGIN, { EDGE_ENV: 'development' })).status).toBe(404);
  });
});
