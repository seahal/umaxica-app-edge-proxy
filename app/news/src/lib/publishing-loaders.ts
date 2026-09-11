import { createServerOnlyFn } from '@tanstack/react-start';

import type { Locale } from '../i18n';
import type { EntriesPageView, EntryView } from './publishing-data';
import type { SearchResult } from './search/search-source';

/*
 * The seam between the Publishing routes and Rails.
 *
 * `createServerOnlyFn`, not `createServerFn`, and the difference is the
 * architecture. A server function is an RPC endpoint the browser can call; that
 * would be a browser-facing JSON API into Rails, which this unit does not have.
 * A server-only function is compiled OUT of the client bundle and replaced with
 * one that throws, so Rails is reachable from SSR and from nowhere else.
 *
 * That is safe because a Publishing loader never runs in the browser: every
 * link on these pages is a plain `<a>` (a full document request), and hydration
 * reuses the loader data the server serialized instead of re-running it.
 *
 * `publishing-data.ts` is imported dynamically, inside the server-only body, so
 * the VPC transport and the `cloudflare:workers` module never enter the client
 * module graph at all.
 */

export const loadEntriesPage = createServerOnlyFn(
  async (locale: Locale, page: number): Promise<EntriesPageView> => {
    const { readEntriesPage } = await import('./publishing-data');
    return readEntriesPage(locale, page);
  },
);

export const loadEntry = createServerOnlyFn(
  async (locale: Locale, publicId: string): Promise<EntryView> => {
    const { readEntry } = await import('./publishing-data');
    return readEntry(locale, publicId);
  },
);

/*
 * Search runs through the same seam. Today's source is fixture data that could
 * run anywhere, but the source it stands in for is Rails, which only the server
 * can reach — so the search route is server-only from the start, and the
 * fixtures stay out of the client bundle.
 */
export const loadSearchResults = createServerOnlyFn(
  async (locale: Locale, query: string): Promise<SearchResult[]> => {
    if (query === '') return [];
    const [{ getSearchSource }, { PUBLISHING_AUDIENCE, PUBLISHING_SURFACE }] = await Promise.all([
      import('./search/current-source'),
      import('./publishing-cell'),
    ]);
    return getSearchSource().search({
      query,
      locale,
      surface: PUBLISHING_SURFACE,
      audience: PUBLISHING_AUDIENCE,
    });
  },
);
