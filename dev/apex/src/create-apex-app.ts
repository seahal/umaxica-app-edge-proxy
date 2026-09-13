import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { etag } from 'hono/etag';
import { HTTPException } from 'hono/http-exception';
import { languageDetector } from 'hono/language';
import { timeout } from 'hono/timeout';

import { apexCsrf } from './csrf';
import { locales } from './i18n/config';
import { checkRateLimit } from './rate-limit';
import { renderer } from './renderer';
import { renderAggregateHealth, renderHealthApi, renderProbe } from './runtime-health';
import { apexSecurityHeaders, type AssetEnv } from './security-headers';
import type { Meta } from './seo';
import { errorPage, notFoundPage, offlinePageMarkup } from './status-page';
import { apexStructuredLogger, type BaseLogger } from './structured-logger';
import { requestThemeAttribute } from './theme';

export type ApexEnv = {
  Bindings: AssetEnv;
  Variables: {
    meta?: Meta;
    // Set by `apexStructuredLogger`. Declared here so `c.get('logger')` is
    // typed at every call site instead of being asserted back into shape.
    logger: BaseLogger;
  };
};

// Hono types `c.env` as always present. It is not: the app runs with no
// bindings at all outside the Workers runtime, which is what every
// `app.request(path)` in the test suite does. Reading it through this
// widening accessor keeps the guards below honest instead of leaving
// optional chains the type checker believes are dead.
const bindings = (c: Context<ApexEnv>): AssetEnv | undefined => c.env;

/*
 * What a cache has to know before it may reuse one of these documents for a
 * second request to the same URL.
 *
 * Two cookies change the document and neither appears in the URL: `language`
 * decides the copy (`languageDetector`) and `theme` decides the colour scheme
 * (`theme.ts`). `Accept-Language` is here because the detector falls back to it
 * when the cookie is absent — which is the first visit, the one most likely to
 * be stored.
 *
 * Nothing caches these today: Cloudflare does not store a Worker's own
 * response unless the Worker asks it to, and none of these carry
 * `Cache-Control: public`. The header is here because that is a property of
 * how they are served rather than of what they are, and a 200 with no
 * freshness information is a candidate for heuristic caching in any
 * intermediary that does keep one.
 */
const NEGOTIATED_ON = 'Cookie, Accept-Language';

/*
 * HTML only. `/revision` is negotiated by nothing, and
 * `/assets/*` is answered by the assets binding before this Worker runs.
 *
 * `no-store` responses — the status, 404 and error documents — are left alone:
 * a cache told not to store one has nothing left to vary.
 */
const varyOnNegotiation: MiddlewareHandler = async (c, next) => {
  await next();
  const headers = c.res.headers;
  if (
    !headers.get('content-type')?.startsWith('text/html') ||
    headers.get('cache-control')?.includes('no-store')
  ) {
    return;
  }

  /*
   * Appended, never assigned. Whatever fronts this Worker adds a `Vary` of its
   * own — `vite dev` adds `Origin` to every response — and overwriting it would
   * silently drop a directive this code knows nothing about. It is also why the
   * assertions in `api/theme.hurl` read the header by substring rather than
   * whole: the rest of the value differs between `vite dev` and a deployment.
   */
  headers.append('Vary', NEGOTIATED_ON);
};

/*
 * The probes the rate limiter must never see, and the reason the set is this
 * small.
 *
 * Each of these three is a constant — no binding read, no downstream hop,
 * nothing that can fail. A 429 on one of them is indistinguishable from a dead
 * isolate, so an endpoint an orchestrator trusts to mean "alive" must not be
 * throttleable.
 *
 * `/health` and `/health/readinesses` are deliberately absent. They answer from
 * this isolate on an apex Worker, but they reach Rails over the Workers VPC
 * binding on a Core and on an Astro surface, and this exemption is written once
 * for all twenty units rather than per family: a set that means "cheap here,
 * an uncounted path into Rails there" is not a rule anyone can check. Readiness
 * is the probe whose job is to answer "do not send me traffic"; being throttled
 * is a correct answer for it, and is not one for liveness or startup.
 *
 * `/revision` and `/api/v0/revision.json` are absent too: deployment metadata,
 * not probes. Nothing operational breaks when one of them is throttled, so
 * there is no reason to hand out an uncounted Worker invocation.
 */
function isUnmeteredProbe(path: string): boolean {
  return (
    path === '/health/startups' || path === '/health/livenesses' || path === '/api/v0/health.json'
  );
}

/*
 * Every machine-facing endpoint, which is a WIDER set than the one above and
 * answers a different question: which responses must not be language-negotiated.
 *
 * `languageDetector` writes a `language` cookie as a side effect of running.
 * A monitor polling `/revision` is not a browser expressing a preference, and a
 * machine document that varies by locale is a document no probe can diff. Both
 * concerns used to share one path list, which is what let the limiter quietly
 * inherit the revision endpoints.
 */
function isMachineEndpoint(path: string): boolean {
  return (
    path === '/health' ||
    path.startsWith('/health/') ||
    path === '/api/v0/health.json' ||
    path === '/revision' ||
    path === '/api/v0/revision.json'
  );
}

type ConfigurePageRoutes = (pageRoutes: Hono<ApexEnv>) => void;

export function createApexApp(configurePageRoutes: ConfigurePageRoutes) {
  const app = new Hono<ApexEnv>();
  const pageRoutes = new Hono<ApexEnv>();

  app.use('*', apexSecurityHeaders);
  app.use('*', varyOnNegotiation);
  app.use(etag());
  app.use(apexStructuredLogger);
  app.use(async (c, next) => {
    if (isUnmeteredProbe(c.req.path)) return next();
    const blocked = await checkRateLimit(c.req.raw, bindings(c)?.RATE_LIMITER);
    if (blocked) return blocked;
    return next();
  });
  app.use('*', apexCsrf);
  // Reads the locale set from this unit's own config rather than repeating
  // it, so the detector and `<html lang>` cannot disagree. Machine health
  // must not emit a language cookie as a side effect.
  const detectLanguage = languageDetector({
    supportedLanguages: [...locales],
    fallbackLanguage: 'en',
  });
  app.use(async (c, next) => {
    if (isMachineEndpoint(c.req.path)) return next();
    return detectLanguage(c, next);
  });

  pageRoutes.use(renderer);
  configurePageRoutes(pageRoutes);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const response = err.getResponse();
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('Content-Type', 'text/html; charset=UTF-8');
      return new Response(
        errorPage(response.status, c.get('language'), requestThemeAttribute(c.req.raw)).body,
        {
          status: response.status,
          headers,
        },
      );
    }

    // oxlint-disable-next-line no-console
    console.error('Unhandled apex error', {
      /*
       * `err.name` is read unguarded. Hono only routes a thrown value to
       * `onError` when it is an `Error` and re-throws everything else
       * (`compose.ts`), which is also why the handler is typed `err: Error`, so
       * the `'UnknownError'` fallback this replaced could never be reached.
       */
      error: err.name,
      method: c.req.method,
      path: c.req.path,
    });

    return errorPage(500, c.get('language'), requestThemeAttribute(c.req.raw));
  });

  app.get('/health/startups', timeout(2000), () => renderProbe('startup'));
  app.get('/health/livenesses', timeout(2000), () => renderProbe('liveness'));
  app.get('/health/readinesses', timeout(2000), () => renderProbe('readiness'));
  app.get('/health', timeout(2000), () => renderAggregateHealth());
  app.get('/api/v0/health.json', timeout(2000), () => renderHealthApi());
  const versionMetadata = (c: Context<ApexEnv>) => {
    const { id = null, tag = null, timestamp = null } = bindings(c)?.CF_VERSION_METADATA ?? {};
    return { id, tag, timestamp };
  };
  app.get('/revision', (c) => {
    const { id } = versionMetadata(c);
    return c.text(`${id ?? 'unknown'}\n`, 200, {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
  });
  app.get('/api/v0/revision.json', (c) => {
    return c.json(versionMetadata(c), 200, {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
  });
  app.get('/offline', (c) => c.html(offlinePageMarkup(requestThemeAttribute(c.req.raw))));
  app.route('/', pageRoutes);
  app.notFound((c) => notFoundPage(c.get('language'), requestThemeAttribute(c.req.raw)));

  return app;
}
