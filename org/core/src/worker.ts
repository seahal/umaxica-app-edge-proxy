import appHandler from './lib/app-handler';
import { blockedCoreResponse, classifyCorePath, dispatchToRails } from './lib/core-dispatch';
import { sanitizeHealthRequest } from './lib/health-request';
import { checkRateLimit } from './lib/rate-limit';
import { withSecurityHeaders } from './security-headers';

/**
 * First code the Workers runtime invokes for every request to this frame's Core
 * hostname — before any application code runs. The hostname itself is
 * `PUBLIC_CORE_HOST` in `./lib/core-dispatch`, which is the one line that
 * differs between the three brands; this file is byte-identical across all
 * three, so it names no brand. See `adr/007-shared-fqdn-core-dispatch.md`.
 *
 * - Rails-owned paths never reach `appHandler.fetch`: dispatched directly to
 *   Rails at `RAILS_ORIGIN`, with the browser's Cookie/CSRF/auth headers
 *   preserved verbatim.
 * - Blocked paths never reach Rails or the application.
 * - Everything else (the default) is application-owned: the inbound `Cookie`
 *   header is stripped before `appHandler.fetch` is ever called, and any
 *   outbound `Set-Cookie` is stripped from the response before it reaches the
 *   browser — application code never observes a `Cookie` it was sent, and never
 *   gets to set one the browser will keep.
 *
 *   This file names `./lib/app-handler` rather than a framework, so which
 *   framework renders the application half stays behind that one-function seam.
 *
 * Rate limiting happens here, once, for both branches — the first-touch position
 * `adr/010-first-touch-rate-limiting.md` requires. Answering it here rather than
 * inside the application half is what keeps a rejected request from booting the
 * application at all.
 *
 * Every response this file produces ITSELF — the block, the 429, the 503 — goes
 * through `withSecurityHeaders`. `app-handler.ts` headers the documents the
 * application renders and a Rails-owned response stays Rails' to header (that is
 * the ADR 007 boundary), but the three answered here belong to neither and were
 * previously served bare: no CSP, no `X-Frame-Options`, no `nosniff`. They carry
 * no nonce because none of them carries a script.
 */

/**
 * Every machine-facing path this frame serves.
 *
 * Drives `sanitizeHealthRequest` only. Deliberately WIDER than
 * `isUnmeteredProbe` below: dropping non-ASCII client headers before the
 * application sees them is free and has nothing to do with what the limiter
 * counts, so the two questions are asked separately even though the older
 * spelling answered both with one list.
 */
function isHealthPath(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname === '/health/startups' ||
    pathname === '/health/livenesses' ||
    pathname === '/health/readinesses' ||
    pathname === '/api/v0/health.json'
  );
}

/**
 * The probes the rate limiter must never see, and the reason the set is this
 * small.
 *
 * Each of these three is a constant: no binding read, no Rails hop, nothing that
 * can fail. A 429 on one of them is indistinguishable from a dead isolate, so an
 * endpoint an orchestrator trusts to mean "alive" must not be throttleable.
 *
 * `/health` and `/health/readinesses` are deliberately absent. Both fetch Rails
 * at `RAILS_ORIGIN` (`src/routes/health.ts`,
 * `src/routes/health.readinesses.ts`), so exempting them publishes an
 * unauthenticated, uncounted path into the Rails origin — one inbound request,
 * one outbound Rails request, no ceiling. Readiness is the probe whose job is to
 * answer "do not send me traffic"; being throttled is a correct answer for it,
 * and is not a correct answer for liveness or startup.
 *
 * The same three paths are the exempt set in every apex `create-apex-app.ts`
 * and every Astro surface's `src/middleware.ts`. One rule, twenty units.
 */
function isUnmeteredProbe(pathname: string): boolean {
  return (
    pathname === '/health/startups' ||
    pathname === '/health/livenesses' ||
    pathname === '/api/v0/health.json'
  );
}

/**
 * Paths the rate limiter does not see.
 *
 * Cloudflare matches static assets BEFORE this Worker runs, so in production
 * none of these reach this function at all — the exemption is what keeps that
 * true in the places where they do, and it costs one string comparison.
 *
 * `/assets/` is where Vite writes this frame's hashed output, and the favicon is
 * the one unhashed file a document references. There is no image-optimisation
 * route: if one is ever added it is a real Worker route, so a page with many
 * images could spend its whole budget on its own thumbnails — exempt it here at
 * the same time.
 *
 * `/revision` and `/api/v0/revision.json` are NOT here. They read a binding and
 * answer immediately, but they are deployment metadata rather than probes:
 * nothing operational breaks when one of them is throttled, so there is no
 * reason to hand out an uncounted Worker invocation on a path anyone can call.
 */
function isRateLimitExempt(pathname: string): boolean {
  return (
    pathname.startsWith('/assets/') || pathname === '/favicon.ico' || isUnmeteredProbe(pathname)
  );
}

/**
 * The Rails-owned paths that authenticate, rather than merely read.
 *
 * These count against `AUTH_RATE_LIMITER`, a separate and much smaller budget
 * than the page-view limiter. Sharing one budget meant an OIDC endpoint was as
 * cheap to hammer as a static page — ASVS V2.2.1 asks for anti-automation on the
 * authentication path specifically, and a limit sized for ordinary browsing is
 * not that.
 *
 * Both limiters are consulted for these paths, not one instead of the other: the
 * general budget still bounds total traffic from a client, and this one bounds
 * the part of it that can attempt a credential.
 */
function isAuthPath(pathname: string): boolean {
  return (
    pathname.startsWith('/oidc/') ||
    pathname === '/oidc' ||
    pathname === '/sign/out' ||
    pathname === '/sign/out/complete'
  );
}

export default {
  // `_ctx` is unused: the application half is a plain `Request -> Response`
  // function. The parameter stays in the signature because the runtime supplies
  // it and a future `waitUntil` would want it.
  async fetch(request: Request, env: CloudflareEnv, _ctx: ExecutionContext) {
    const isProduction = import.meta.env.PROD;
    const pathname = new URL(request.url).pathname;
    const ownership = classifyCorePath(pathname);

    // Cheapest first: a blocked path costs nothing and is not worth a limiter
    // call, since it reaches no application code either way.
    if (ownership === 'blocked') {
      return withSecurityHeaders(blockedCoreResponse(), isProduction);
    }

    if (!isRateLimitExempt(pathname)) {
      const rateLimitedResponse = await checkRateLimit(request, env.RATE_LIMITER);
      if (rateLimitedResponse) return withSecurityHeaders(rateLimitedResponse, isProduction);
    }

    if (isAuthPath(pathname)) {
      const authLimitedResponse = await checkRateLimit(request, env.AUTH_RATE_LIMITER);
      if (authLimitedResponse) return withSecurityHeaders(authLimitedResponse, isProduction);
    }

    if (ownership === 'rails') {
      // Rails headers its own responses; the 503 substituted when the dispatch
      // never reached Rails is Edge's own document, so `dispatchToRails` headers
      // that one itself rather than reporting back which case it took.
      return dispatchToRails(request, env, isProduction);
    }

    const sanitizedRequest = isHealthPath(pathname) ? sanitizeHealthRequest(request) : request;
    const strippedHeaders = new Headers(sanitizedRequest.headers);
    strippedHeaders.delete('cookie');
    const strippedRequest = new Request(sanitizedRequest, { headers: strippedHeaders });

    const response = await appHandler.fetch(strippedRequest);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('set-cookie');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
