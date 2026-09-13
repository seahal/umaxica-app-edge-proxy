import type { RailsClient, RailsClientResult } from './rails-client';

/*
 * Rails' machine-facing Health API, and the authority for whether this frame's
 * Rails entry point is available.
 *
 * Operational Kubernetes probes (`/health`, `/health/livenesses`, …) stay on
 * Rails and are not read from Edge. Edge verifies Rails over Workers VPC with
 * one request:
 *
 *   GET /api/v0/health.json
 *
 * The path carries no frame prefix. Rails routes on the path exactly as given
 * and picks `<Frame>::<Brand>::…` from the `Host` header instead, which
 * `PRIVATE_RAILS_ORIGIN` in `rails-client.ts` supplies per frame. A prefix here
 * produces `ActionController::RoutingError` — see
 * `adr/006-development-workers-vpc-transport.md` §4.
 *
 * This file is the consumer of that API. It does not serialize Edge's public
 * `/health` document; callers map the closed `kind` onto Edge's own contract.
 */
const RAILS_HEALTH_API_PATH = '/api/v0/health.json';

const JSON_BODY_MAX_CHARS = 65536;

export type HealthStatus = 'pass' | 'warn' | 'fail';

export interface HealthCheck {
  status: HealthStatus;
}

export interface RailsHealthApiDocument {
  status: HealthStatus;
  timestamp: string;
  checks: {
    startup: HealthCheck;
    liveness: HealthCheck;
    readiness: HealthCheck;
  };
}

export type RailsHealthKind =
  | 'not-configured'
  | 'unreachable'
  | 'http-error'
  | 'invalid-contract'
  | 'pass'
  | 'warn'
  | 'fail';

/**
 * What a probe is allowed to say in public.
 *
 * `status` is present only when Rails or the VPC actually produced an HTTP
 * status. There is deliberately no message field and no copy of the Rails body.
 */
export interface RailsHealthReport {
  kind: RailsHealthKind;
  status?: number;
}

/**
 * Edge operational readiness: pass and warn are serving; fail and every
 * transport/contract failure are not. `not-configured` is a missing binding in
 * this process, not a Rails outage, so it does not mark the Worker unready.
 */
export function edgeReadinessFromRails(report: RailsHealthReport): 'ok' | 'error' {
  switch (report.kind) {
    case 'pass':
    case 'warn':
    case 'not-configured':
      return 'ok';
    case 'fail':
    case 'http-error':
    case 'invalid-contract':
    case 'unreachable':
      return 'error';
  }
}

export async function checkRailsHealth(client: RailsClient | null): Promise<RailsHealthReport> {
  if (!client) {
    return { kind: 'not-configured' };
  }

  const result = await client.fetch(RAILS_HEALTH_API_PATH);
  return interpretHealthResult(result);
}

async function interpretHealthResult(result: RailsClientResult): Promise<RailsHealthReport> {
  if (result.kind === 'ok' || result.kind === 'http-error') {
    return interpretHttpHealth(result.status, result.response);
  }
  return { kind: 'unreachable' };
}

async function interpretHttpHealth(
  httpStatus: number,
  response: Response,
): Promise<RailsHealthReport> {
  if (httpStatus >= 300 && httpStatus < 400) {
    return { kind: 'invalid-contract', status: httpStatus };
  }

  if (httpStatus !== 200 && httpStatus !== 503) {
    return { kind: 'http-error', status: httpStatus };
  }

  if (!isJsonMediaType(response.headers.get('content-type'))) {
    return { kind: 'invalid-contract', status: httpStatus };
  }

  return interpretJsonHealth(httpStatus, response);
}

async function interpretJsonHealth(
  httpStatus: number,
  response: Response,
): Promise<RailsHealthReport> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { kind: 'invalid-contract', status: httpStatus };
  }

  if (text.length > JSON_BODY_MAX_CHARS) {
    return { kind: 'invalid-contract', status: httpStatus };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'invalid-contract', status: httpStatus };
  }

  const document = parseHealthDocument(parsed);
  if (document === null) {
    return { kind: 'invalid-contract', status: httpStatus };
  }

  if (httpStatus === 200 && (document.status === 'pass' || document.status === 'warn')) {
    return { kind: document.status, status: httpStatus };
  }
  if (httpStatus === 503 && document.status === 'fail') {
    return { kind: 'fail', status: httpStatus };
  }
  return { kind: 'invalid-contract', status: httpStatus };
}

function parseHealthDocument(value: unknown): RailsHealthApiDocument | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const status: unknown = Reflect.get(value, 'status');
  if (!isHealthStatus(status)) {
    return null;
  }
  const timestamp: unknown = Reflect.get(value, 'timestamp');
  if (!isTimezoneAwareTimestamp(timestamp)) {
    return null;
  }
  const checksValue: unknown = Reflect.get(value, 'checks');
  if (typeof checksValue !== 'object' || checksValue === null || Array.isArray(checksValue)) {
    return null;
  }
  const startup = parseCheck(Reflect.get(checksValue, 'startup'));
  const liveness = parseCheck(Reflect.get(checksValue, 'liveness'));
  const readiness = parseCheck(Reflect.get(checksValue, 'readiness'));
  if (startup === null || liveness === null || readiness === null) {
    return null;
  }
  return {
    status,
    timestamp,
    checks: { startup, liveness, readiness },
  };
}

const TIMEZONE_AWARE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function isTimezoneAwareTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    TIMEZONE_AWARE_TIMESTAMP.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function parseCheck(value: unknown): HealthCheck | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const status: unknown = Reflect.get(value, 'status');
  if (!isHealthStatus(status)) {
    return null;
  }
  return { status };
}

function isHealthStatus(value: unknown): value is HealthStatus {
  return value === 'pass' || value === 'warn' || value === 'fail';
}

function isJsonMediaType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  /*
   * Sliced at the first `;` rather than `split(';')[0]`. Under
   * `noUncheckedIndexedAccess` the indexed form is typed `string | undefined`
   * and needs a `?? ''` fallback for a case `String.prototype.split` cannot
   * produce — it always yields at least one element. That fallback was an
   * always-false branch no test could reach, and the only thing standing
   * between this file and full branch coverage. Both arms below are real:
   * `application/json` takes one, `application/json; charset=utf-8` the other.
   */
  const separator = contentType.indexOf(';');
  const mediaType = (separator === -1 ? contentType : contentType.slice(0, separator))
    .trim()
    .toLowerCase();
  return mediaType === 'application/json';
}
