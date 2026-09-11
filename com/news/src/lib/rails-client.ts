import '@tanstack/react-start/server-only';
import { readBoundedText } from './bounded-text';
import type { EdgeBindings } from './env';
import { PRIVATE_RAILS_ORIGIN } from './publishing-cell';

/*
 * The private Worker → Rails transport for this public content unit.
 *
 * Server-only: `@tanstack/react-start/server-only` makes the build fail if a
 * client bundle ever reaches this module, so the private origin and the VPC
 * binding cannot leak into the browser.
 *
 * Everything the invariant suite pins is here: the credential strip, the
 * relative-path validation, `redirect: 'manual'` (a Rails redirect is an
 * upstream error, never followed), `cache: 'no-store'`, the 5 s timeout, and
 * the `ProxyError` → `unreachable` classification.
 *
 * The origin is this cell's `PRIVATE_RAILS_ORIGIN` (`src/lib/publishing-cell.ts`).
 */

const RAILS_FETCH_TIMEOUT_MS = 5000;

// Stripped from every outbound request, always. Never relay a caller's
// credentials to Rails — a browser session cookie or an inbound Access token
// must not become a Rails-side identity.
const FORBIDDEN_REQUEST_HEADERS = [
  'cookie',
  'authorization',
  'cf-access-client-id',
  'cf-access-client-secret',
];

export interface RailsFetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export type RailsClientInit = Pick<RequestInit, 'method' | 'headers' | 'body'>;

export type RailsClientResult =
  | { kind: 'ok'; status: number; response: Response }
  | { kind: 'http-error'; status: number; response: Response }
  | { kind: 'timeout' }
  | { kind: 'unreachable'; errorMessage: string }
  | { kind: 'invalid-path'; reason: string };

export interface RailsClient {
  fetch(path: string, init?: RailsClientInit): Promise<RailsClientResult>;
}

function readLocalFlag(name: string): string | undefined {
  const processEnv: unknown = typeof process === 'undefined' ? undefined : process.env;
  if (typeof processEnv !== 'object' || processEnv === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(processEnv, name);
  return typeof value === 'string' ? value : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasControlCharacter(path: string): boolean {
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function validateRelativePath(path: string): string | null {
  if (path.length === 0) {
    return 'path must not be empty';
  }
  if (!path.startsWith('/')) {
    return 'path must start with a single leading slash';
  }
  if (path.startsWith('//')) {
    return 'path must not be protocol-relative';
  }
  if (path.includes('://')) {
    return 'path must not embed a scheme';
  }
  if (path.includes('\\')) {
    return 'path must not contain a backslash';
  }
  if (hasControlCharacter(path)) {
    return 'path must not contain control characters';
  }
  return null;
}

const PROXY_ERROR_MAX_CHARS = 200;

/**
 * The `ProxyError: <code>` that Workers VPC returns when it cannot reach the
 * private origin, or null for any other response. Only a 500 with a `text/plain`
 * body is inspected, and the body is read from a clone.
 */
async function readProxyError(response: Response): Promise<string | null> {
  if (response.status !== 500) {
    return null;
  }
  if (!response.headers.get('content-type')?.startsWith('text/plain')) {
    return null;
  }

  try {
    const body = await readBoundedText(response.clone(), PROXY_ERROR_MAX_CHARS);
    return /^ProxyError:\s*\w+/iu.test(body) ? body : null;
  } catch {
    return null;
  }
}

function buildSanitizedHeaders(init: RailsClientInit | undefined): Headers {
  const headers = new Headers(init?.headers);
  for (const forbidden of FORBIDDEN_REQUEST_HEADERS) {
    headers.delete(forbidden);
  }
  return headers;
}

export function createRailsClient(fetcher: RailsFetcher, origin: string): RailsClient {
  return {
    async fetch(path, init) {
      const validationError = validateRelativePath(path);
      if (validationError) {
        return { kind: 'invalid-path', reason: validationError };
      }

      const url = new URL(path, `${origin}/`);
      if (url.origin !== origin) {
        return { kind: 'invalid-path', reason: 'path resolved outside the fixed origin' };
      }

      try {
        const response = await fetcher.fetch(url.toString(), {
          ...(init?.method === undefined ? {} : { method: init.method }),
          ...(init?.body === undefined ? {} : { body: init.body }),
          headers: buildSanitizedHeaders(init),
          redirect: 'manual',
          cache: 'no-store',
          signal: AbortSignal.timeout(RAILS_FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          const proxyError = await readProxyError(response);
          if (proxyError) {
            return { kind: 'unreachable', errorMessage: proxyError };
          }
          return { kind: 'http-error', status: response.status, response };
        }

        return { kind: 'ok', status: response.status, response };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          return { kind: 'timeout' };
        }
        return { kind: 'unreachable', errorMessage: getErrorMessage(error) };
      }
    },
  };
}

/**
 * Two mutually exclusive transports, selected by an actual runtime capability:
 *
 * 1. Local dev (`EDGE_LOCAL_NODE_RUNTIME=1` and `EDGE_LOCAL_RAILS_ENABLED=1`)
 *    → direct private network, no Access token.
 * 2. VPC binding → workerd. Cloudflare grants the real binding.
 * 3. Neither → null, reported as `not-configured`. Fail closed.
 *
 * The local check runs first — a Workers VPC binding has no local simulator and
 * is truthy-but-throwing without `remote: true`, so testing it first would make
 * the direct transport dead code.
 */
export function getRailsClient(env: EdgeBindings): RailsClient | null {
  const isLocalNodeRuntime = readLocalFlag('EDGE_LOCAL_NODE_RUNTIME') === '1';

  if (isLocalNodeRuntime) {
    if (readLocalFlag('EDGE_LOCAL_RAILS_ENABLED') === '1') {
      return createRailsClient({ fetch }, PRIVATE_RAILS_ORIGIN);
    }
    return null;
  }

  const binding = env.UMAXICA_APPS_EDGE_CF_WORKERS_VPC;
  if (binding) {
    return createRailsClient(binding, PRIVATE_RAILS_ORIGIN);
  }

  return null;
}
