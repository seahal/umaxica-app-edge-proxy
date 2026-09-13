import { getEdgeBindings } from './lib/env';
import { applyPublishingStatus } from './lib/publishing-status';
import { checkRateLimit } from './lib/rate-limit';
import { withSecurityHeaders } from './security-headers';
import { createNonce, runWithNonce } from './security-nonce';

/*
 * Everything this unit does around the router, in a function that takes the
 * router as an argument.
 *
 * `src/server.ts` is the wiring that hands it TanStack's fetch handler; keeping
 * the behaviour here is what makes the request boundary testable without
 * resolving `@tanstack/react-start/server-entry`, which only the Worker build
 * can resolve.
 *
 * Order is the contract:
 *
 * 1. First touch (adr/010): the rate limiter answers before the router runs at
 *    all. The three constant probes are exempt — a 429 on one of them is
 *    indistinguishable from a dead isolate. `/health` and `/health/readinesses`
 *    are NOT exempt: both reach Rails, and an uncounted path into Rails is what
 *    the limiter exists to prevent. The same three paths are the exempt set in
 *    every Core `src/worker.ts` and every apex `create-apex-app.ts`.
 * 2. One CSP nonce per production request, published to `getRouter()` so
 *    TanStack stamps it on its inline hydration script, and named in the policy.
 * 3. A Publishing failure status is moved onto the status line
 *    (`src/lib/publishing-status.ts`).
 * 4. The security headers land on whatever comes back — including the 404 and
 *    500 documents the router produces, and the 429 above.
 *
 * Static assets never reach here: Cloudflare matches them before the Worker
 * runs, and `public/_headers` covers them.
 */
const UNMETERED_PROBES = new Set(['/health/startups', '/health/livenesses', '/api/v0/health.json']);

export async function handleRequest(
  request: Request,
  // Widened to what TanStack's handler actually is — it may answer synchronously
  // — rather than narrowed at the call site with an assertion.
  routerFetch: (request: Request) => Response | Promise<Response>,
  isProduction: boolean,
): Promise<Response> {
  if (!UNMETERED_PROBES.has(new URL(request.url).pathname)) {
    const limited = await checkRateLimit(request, getEdgeBindings().RATE_LIMITER);
    if (limited) return withSecurityHeaders(limited, isProduction);
  }

  const nonce = isProduction ? createNonce() : undefined;
  const response = await runWithNonce(nonce, () => routerFetch(request));

  return withSecurityHeaders(applyPublishingStatus(response), isProduction, nonce);
}
