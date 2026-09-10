import { defineMiddleware } from 'astro:middleware';

import { checkRateLimit } from './lib/rate-limit';
import { withSecurityHeaders } from './lib/security-headers';

/*
 * The probes the rate limiter must never see, and the reason the set is this
 * small.
 *
 * Each of these three is a constant — no binding read, no Rails hop, nothing
 * that can fail. A 429 on one of them is indistinguishable from a dead isolate,
 * so an endpoint an orchestrator trusts to mean "alive" must not be
 * throttleable.
 *
 * `/health` and `/health/readinesses` are deliberately absent, and both are
 * on-demand routes that fetch Rails over the Workers VPC binding
 * (`src/pages/health.ts`, `src/pages/health/readinesses.ts`). Exempting them
 * would publish an unauthenticated, uncounted path into the Rails origin — one
 * inbound request, one outbound Rails request, no ceiling. Readiness is the
 * probe whose job is to answer "do not send me traffic"; being throttled is a
 * correct answer for it, and is not one for liveness or startup.
 *
 * `/revision` and `/api/v0/revision.json` are absent too: deployment metadata,
 * not probes, and `prerender = false` on both, so every call is a real Worker
 * invocation. Nothing operational breaks when one of them is throttled.
 *
 * The same three paths are the exempt set in every Core's `src/worker.ts` and
 * every apex `create-apex-app.ts`. One rule, twenty units.
 */
const UNMETERED_PROBES = new Set(['/health/startups', '/health/livenesses', '/api/v0/health.json']);

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (path === '/offline/') {
    return context.rewrite('/offline');
  }

  /*
   * First touch for this unit (adr/010). Prerendered routes run this middleware
   * at BUILD time, where there is no limiter to call and no client to limit, so
   * they are skipped: `isPrerendered` is the only thing that distinguishes the
   * two, since the module is loaded by both the prerender build and the Worker.
   *
   * `./lib/env` reads `cloudflare:workers`, which the prerender build (running
   * under `prerenderEnvironment: 'node'`) cannot resolve. Importing it inside
   * this branch keeps it out of the prerender module graph entirely; the Worker
   * pays the dynamic import once, on the first on-demand request.
   */
  if (!context.isPrerendered && !UNMETERED_PROBES.has(path)) {
    const { getEdgeBindings } = await import('./lib/env');
    const limited = await checkRateLimit(context.request, getEdgeBindings().RATE_LIMITER);
    if (limited) {
      return withSecurityHeaders(limited, import.meta.env.PROD);
    }
  }

  const response = await next();
  const secured = withSecurityHeaders(response, import.meta.env.PROD);
  if (path === '/health' || path.startsWith('/health/')) {
    const headers = new Headers(secured.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(secured.body, {
      status: secured.status,
      statusText: secured.statusText,
      headers,
    });
  }
  if (
    path === '/api/v0/health.json' ||
    path === '/api/v0/revision.json' ||
    path === '/api/v0/entries'
  ) {
    const headers = new Headers(secured.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(secured.body, {
      status: secured.status,
      statusText: secured.statusText,
      headers,
    });
  }
  if (path === '/revision') {
    const headers = new Headers(secured.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(secured.body, {
      status: secured.status,
      statusText: secured.statusText,
      headers,
    });
  }
  return secured;
});
