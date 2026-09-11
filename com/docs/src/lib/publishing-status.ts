import { NO_STORE } from './cache-policy';

/*
 * How a Publishing route answers 502 / 503 / 504 through a router that only
 * knows 200, 404 and 500.
 *
 * TanStack Start derives a document's status from the route tree: 404 for the
 * not-found signal, 500 for a thrown error, 200 otherwise. A failed Rails read
 * needs the status the failure actually was — a timeout is a 504, an unreachable
 * VPC a 503, an invalid Rails response a 502 — so the route renders its
 * unavailable document and names the status in an internal response header from
 * its `headers()` option. `src/request-handler.ts`, which already wraps every
 * response, moves that value onto the status line and removes the header before
 * the response leaves the Worker. It never reaches a client.
 *
 * Only the statuses a Publishing failure can map to are accepted, and only onto
 * a response the router rendered as 200, so a route cannot use this to mask a
 * real 404 or 500 or to mint an arbitrary status.
 */
export const PUBLISHING_STATUS_HEADER = 'x-umaxica-publishing-status';

const FAILURE_STATUSES = new Set([400, 500, 502, 503, 504]);

/** Headers for a Publishing page that did NOT render content. Never cacheable. */
export function publishingFailureHeaders(status?: number): Record<string, string> {
  return {
    'Cache-Control': NO_STORE,
    'X-Robots-Tag': 'noindex, nofollow',
    ...(status === undefined ? {} : { [PUBLISHING_STATUS_HEADER]: String(status) }),
  };
}

/**
 * The response headers of a Publishing page, from its loader data. Rendered
 * content gets `cacheControl`; anything else — a failure, or no data at all
 * because the route answered not-found — gets the failure headers.
 */
export function publishingPageHeaders(
  view: { kind: 'ok' } | { kind: 'error'; status: number } | undefined,
  cacheControl: string,
): Record<string, string> {
  if (view?.kind === 'ok') return { 'Cache-Control': cacheControl };
  return publishingFailureHeaders(view?.status);
}

export function applyPublishingStatus(response: Response): Response {
  const requested = response.headers.get(PUBLISHING_STATUS_HEADER);
  if (requested === null) return response;

  const headers = new Headers(response.headers);
  headers.delete(PUBLISHING_STATUS_HEADER);
  const status = Number(requested);
  return new Response(response.body, {
    status: response.status === 200 && FAILURE_STATUSES.has(status) ? status : response.status,
    headers,
  });
}
