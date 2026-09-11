import { createFixtureSearchSource } from './fixture-search-source';
import { SEARCH_FIXTURES } from './search-fixtures';
import type { SearchSource } from './search-source';

/*
 * The one place that decides which `SearchSource` this unit uses.
 *
 * TEMPORARY: the fixture source, until Rails provides search. Swapping in a
 * Rails-backed source means changing this file — the route depends on
 * `SearchSource`, never on the fixtures.
 */
const source: SearchSource = createFixtureSearchSource(SEARCH_FIXTURES);

export function getSearchSource(): SearchSource {
  return source;
}
