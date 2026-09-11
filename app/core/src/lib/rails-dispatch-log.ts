/**
 * Structured logging for the Edge → Rails hop.
 *
 * Emitted as one JSON line per `console.*` call, which is what
 * `wrangler.jsonc`'s `observability.logs.enabled` already collects into Workers
 * Logs — no new vendor, no new binding. The `{ level, msg, data }` envelope is
 * the same one each apex worker's `src/structured-logger.ts` produces, so both
 * worker classes read alike in the log viewer. That module itself is not
 * reusable here: it is `@hono/structured-logger` middleware, and a Core frame is
 * a bare Workers `fetch` handler with no Hono anywhere in the request path.
 *
 * PRIVACY IS ENFORCED BY THE TYPE, NOT BY THE CALLER.
 *
 * `RailsDispatchLogEntry` is closed and has no free-text field. Every value is
 * either a number or a member of a fixed union, so there is no channel through
 * which a raw Cookie, an `Authorization` header, a CSRF token, a request or
 * response body, a query string, a user id, an email, an access token or the
 * Rails hostname could reach a log line — not even by mistake at a future call
 * site. In particular the raw pathname is never recorded:
 * `classifyRailsRouteClass()` reduces it to one of eight low cardinality classes
 * first, so a path carrying an identifier cannot leak through the route label.
 */

/** Distinguishes success, a Rails-authored error, and the three failure modes. */
export type RailsDispatchOutcome =
  | 'rails_ok'
  | 'rails_http_error'
  | 'upstream_unreachable'
  | 'timeout'
  | 'origin_not_configured';

export type RailsRouteClass =
  | 'api_v0'
  | 'web_v0'
  | 'edge_v0'
  | 'oidc'
  | 'sign_out'
  | 'jwks'
  | 'csp_report'
  | 'other';

export type RailsRequestMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'OTHER';

export interface RailsDispatchLogEntry {
  route_class: RailsRouteClass;
  method: RailsRequestMethod;
  outcome: RailsDispatchOutcome;
  duration_ms: number;
  /** Only when an HTTP response actually arrived. */
  upstream_status?: number;
}

/*
 * The route classes, keyed the same way `classifyCorePath()` keys ownership in
 * `core-dispatch.ts` — exact matches first, then prefixes.
 *
 * Held separately rather than imported from `core-dispatch.ts`, which imports
 * this module: sharing the constants would make the two files circular. The
 * agreement between the two tables is asserted instead, in
 * `test/core-dispatch-contract.test.ts`, which requires every Rails-owned path
 * to classify as something other than `other`.
 */
const ROUTE_CLASS_EXACT = new Map<string, RailsRouteClass>([
  ['/sign/out', 'sign_out'],
  ['/sign/out/complete', 'sign_out'],
  ['/.well-known/jwks.json', 'jwks'],
  ['/csp-violation-report', 'csp_report'],
  ['/api/v0/health.json', 'other'],
  ['/api/v0/revision.json', 'other'],
]);

const ROUTE_CLASS_PREFIXES: ReadonlyArray<readonly [string, RailsRouteClass]> = [
  ['/api/v0', 'api_v0'],
  ['/web/v0', 'web_v0'],
  ['/edge/v0', 'edge_v0'],
  ['/oidc', 'oidc'],
];

const KNOWN_METHODS: ReadonlySet<RailsRequestMethod> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

/**
 * Reduces a pathname to a low cardinality class. Both `/sign/out` and
 * `/sign/out/complete` fold into `sign_out` — they are one flow, and splitting
 * them would buy nothing a status code does not already say.
 */
export function classifyRailsRouteClass(pathname: string): RailsRouteClass {
  const exact = ROUTE_CLASS_EXACT.get(pathname);
  if (exact) {
    return exact;
  }
  for (const [prefix, routeClass] of ROUTE_CLASS_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return routeClass;
    }
  }
  return 'other';
}

const isKnownMethod = (value: string): value is RailsRequestMethod =>
  (KNOWN_METHODS as ReadonlySet<string>).has(value);

/** Anything outside the standard set becomes `OTHER` rather than being echoed. */
export function normalizeRailsMethod(method: string): RailsRequestMethod {
  const upper = method.toUpperCase();
  return isKnownMethod(upper) ? upper : 'OTHER';
}

export function logRailsDispatch(entry: RailsDispatchLogEntry): void {
  const line = JSON.stringify({
    level: levelFor(entry.outcome),
    msg: 'rails_dispatch',
    data: {
      event: 'rails_dispatch',
      ownership: 'rails',
      method: entry.method,
      route_class: entry.route_class,
      outcome: entry.outcome,
      duration_ms: entry.duration_ms,
      ...(entry.upstream_status === undefined ? {} : { upstream_status: entry.upstream_status }),
    },
  });

  if (entry.outcome === 'rails_ok') {
    // oxlint-disable-next-line no-console
    console.log(line);
  } else if (entry.outcome === 'rails_http_error') {
    // oxlint-disable-next-line no-console
    console.warn(line);
  } else {
    // oxlint-disable-next-line no-console
    console.error(line);
  }
}

function levelFor(outcome: RailsDispatchOutcome): 'info' | 'warn' | 'error' {
  if (outcome === 'rails_ok') {
    return 'info';
  }
  return outcome === 'rails_http_error' ? 'warn' : 'error';
}
