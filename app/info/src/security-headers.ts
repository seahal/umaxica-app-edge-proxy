/*
 * Defense-in-depth headers for every response this Worker produces.
 *
 * They are applied at this unit's request boundary, which sees every response
 * the application produces and nothing else — Cloudflare
 * matches static assets BEFORE the Worker runs, so files under `public/` never
 * reach this code and take their headers from `public/_headers` instead. That
 * split is the same one the apex Workers already live with, and `public/_headers`
 * carries its own `nosniff`/`X-Frame-Options` pair for exactly that reason.
 *
 * `vite dev` is the only server that needs a looser policy. The dev bundle and
 * React's development build both call eval(), and Vite injects inline scripts of
 * its own (the HMR client, React Refresh's preamble) that this code never sees
 * and cannot nonce. So the development branch keeps `'unsafe-inline'` and adds
 * `'unsafe-eval'`, and PRODUCTION carries neither: it names a per-request nonce
 * instead (`security-nonce.ts`), which TanStack threads onto the one inline
 * script it emits. Naming a nonce is what makes a browser ignore
 * `'unsafe-inline'`, so the two are alternatives rather than a pair — which is
 * why the branch is on the whole source list and not just one token.
 * `test/content-security-policy.test.ts` asserts both sides of that branch — the
 * Hurl suite runs against `vite dev` and can only ever observe the development
 * half.
 */
function scriptSource(isProduction: boolean, nonce: string | undefined): string {
  if (!isProduction) {
    return "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  }
  return nonce === undefined ? "script-src 'self'" : `script-src 'self' 'nonce-${nonce}'`;
}

/*
 * `style-src` carries no `'unsafe-inline'` in production, and that is a measured
 * claim rather than an aspiration: a production response from this frame
 * contains zero `<style>` elements and zero `style=` attributes. Tailwind
 * compiles to a hashed stylesheet that `__root.tsx` links, and the UI shell
 * contract forbids a static `style=` attribute outright.
 *
 * The nonce is named here as well as on `script-src` because TanStack's `Asset`
 * component threads it onto `<style>` and `<link>` too. Its inline-CSS path is
 * dormant in this build, but if it ever activates the policy already covers it
 * without reopening `'unsafe-inline'`.
 */
function styleSource(isProduction: boolean, nonce: string | undefined): string {
  if (!isProduction) {
    return "style-src 'self' 'unsafe-inline'";
  }
  return nonce === undefined ? "style-src 'self'" : `style-src 'self' 'nonce-${nonce}'`;
}

function contentSecurityPolicy(isProduction: boolean, nonce: string | undefined): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    scriptSource(isProduction, nonce),
    // Event-handler attributes (`onclick="…"`) are never emitted by this unit and
    // are the sink a nonce cannot cover — a nonce authorises elements, not
    // attributes. Stated explicitly because `script-src` does not imply it once a
    // nonce is present.
    "script-src-attr 'none'",
    styleSource(isProduction, nonce),
    "style-src-attr 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/*
 * `preload` is deliberately absent from `Strict-Transport-Security`. Submitting a
 * domain to the browser preload list is effectively irreversible and binds every
 * subdomain to HTTPS, so it is a decision to take once for the whole zone rather
 * than a header a frame adds on its own.
 */
export function securityHeaders(isProduction: boolean, nonce?: string): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(isProduction, nonce),
    'Permissions-Policy':
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

/**
 * Applied to a response that already exists, rather than merged into a headers
 * object at construction: the router owns the body and the status, and this has
 * to reach the documents it produces for a 404 or a thrown error too.
 *
 * `set`, not `append`: a route that has already chosen one of these values is
 * not permitted to widen the policy.
 */
export function withSecurityHeaders(
  response: Response,
  isProduction: boolean,
  nonce?: string,
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(isProduction, nonce))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
