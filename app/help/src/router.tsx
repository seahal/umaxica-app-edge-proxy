import { createRouter } from '@tanstack/react-router';

import { ErrorDocument, NotFoundDocument } from './components/status-documents';
import { routeTree } from './routeTree.gen';
import { getRequestNonce } from './security-nonce';

/*
 * `notFoundMode: 'root'`: this unit has one not-found document and it is the
 * root's, so an unmatched path — or an unsupported locale — is never absorbed
 * by whichever ancestor route happens to sit closest to it.
 *
 * `defaultNotFoundComponent` and `defaultErrorComponent` are NOT redundant with
 * the same two components on the root route: the root's pair covers a failure
 * in the root itself, these cover every descendant route that declares none.
 *
 * `trailingSlash: 'preserve'`. Every URL this unit emits carries a trailing
 * slash (`src/lib/publishing-routes.ts`), but the router must not redirect the
 * extension-less machine paths (`/health`, `/revision`, `/offline`) onto a
 * slashed spelling, and canonical tags — not redirects — are what settle the
 * one spelling of a content URL.
 *
 * Search params are plain `URLSearchParams` strings. The default serializer
 * JSON-decodes values, so `?q=123` would arrive as a number and a search box
 * would behave differently for digits; this unit's only search param is a
 * free-text query.
 *
 * `defaultPreload: false`. Every link is a plain `<a>` — the Publishing loaders
 * are server-only (`src/lib/publishing-loaders.ts`) and must never run in the
 * browser — so there is nothing to preload.
 *
 * `ssr.nonce` puts the CSP nonce on the one inline script TanStack emits. It is
 * read from `AsyncLocalStorage` because `createStartHandler` calls this function
 * with no arguments, once per request.
 */
export function getRouter() {
  const nonce = getRequestNonce();

  return createRouter({
    routeTree,
    defaultPreload: false,
    notFoundMode: 'root',
    trailingSlash: 'preserve',
    defaultNotFoundComponent: NotFoundDocument,
    defaultErrorComponent: ErrorDocument,
    parseSearch: (searchStr) => Object.fromEntries(new URLSearchParams(searchStr)),
    stringifySearch: (search) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(search)) {
        if (typeof value === 'string') params.set(key, value);
      }
      const query = params.toString();
      return query === '' ? '' : `?${query}`;
    },
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
  });
}
