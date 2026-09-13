import '@tanstack/react-start/server-only';
import { getEdgeEnv } from './cloudflare-env';
import { parseRailsOrigin } from './rails-origin';

const RAILS_FETCH_TIMEOUT_MS = 5000;

// Stripped from every outbound request, always. This is about never RELAYING a
// caller's credentials to Rails — a browser session cookie or an inbound Access
// token must not become a Rails-side identity.
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
  | { kind: 'unreachable'; errorMessage: string }
  | { kind: 'invalid-path'; reason: string };

export interface RailsClient {
  fetch(path: string, init?: RailsClientInit): Promise<RailsClientResult>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
          return { kind: 'http-error', status: response.status, response };
        }

        return { kind: 'ok', status: response.status, response };
      } catch (error) {
        return { kind: 'unreachable', errorMessage: getErrorMessage(error) };
      }
    },
  };
}

/**
 * The Rails client for this Core, or null — reported as `not-configured` — when
 * this tier names no Rails origin. Fail closed.
 *
 * One transport in every tier: the Worker's own `fetch` to `RAILS_ORIGIN`. The
 * local loop differs only in where the value comes from (`.dev.vars`, pointing at
 * the development container's Rails), never in code.
 *
 * `fetch` is wrapped rather than passed as `{ fetch }`: called as a method of
 * another object, the runtime's `fetch` receives the wrong `this`, which workerd
 * rejects as an illegal invocation.
 */
export function getRailsClient(): RailsClient | null {
  // Read untyped: no tier declares `RAILS_ORIGIN` yet, so `wrangler types` omits it.
  const origin = parseRailsOrigin(Reflect.get(getEdgeEnv(), 'RAILS_ORIGIN'));
  if (origin === null) {
    return null;
  }
  return createRailsClient({ fetch: (input, init) => fetch(input, init) }, origin);
}
