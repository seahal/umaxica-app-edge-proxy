import type { Locale } from '../../i18n';
import type { PublishingAudience, PublishingSurface } from '../publishing-model';

/*
 * The search abstraction the `/{lang}/search/` route depends on.
 *
 * The route knows this interface and `getSearchSource()` (`current-source.ts`)
 * and nothing else. Today the one implementation is a TEMPORARY fixture source,
 * because Rails does not yet expose search. Replacing it with a Rails-backed
 * source is a change to `current-source.ts` only — no route, component or test
 * of the UI has to know.
 *
 * Every query carries the full cell and the locale, so a source cannot return
 * another surface's, audience's or language's results by omission.
 */
export interface SearchInput {
  query: string;
  locale: Locale;
  surface: PublishingSurface;
  audience: PublishingAudience;
}

export interface SearchResult {
  /** The Entry's `public_id`; results link to `/{lang}/entries/{public_id}/`. */
  publicId: string;
  title: string;
  summary: string;
}

export interface SearchSource {
  search(input: SearchInput): Promise<SearchResult[]>;
}

/** Longer input is truncated, not rejected: a search box should never 4xx. */
export const SEARCH_QUERY_MAX_LENGTH = 200;

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
}
