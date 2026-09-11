import type { Locale } from '../../i18n';
import type { PublishingAudience, PublishingSurface } from '../publishing-model';
import { normalizeSearchQuery, type SearchSource } from './search-source';

/*
 * TEMPORARY. An in-memory `SearchSource` over fixture records, so the search
 * route, its UI, its locale handling and its cell isolation can exist before
 * Rails provides search data.
 *
 * This is not the production search architecture and not a Publishing
 * datastore: it has no index, no ranking and no relation to what Rails
 * publishes. It exists to be deleted when a Rails-backed source replaces it in
 * `current-source.ts`.
 */
export interface SearchFixture {
  publicId: string;
  locale: Locale;
  surface: PublishingSurface;
  audience: PublishingAudience;
  title: string;
  summary: string;
  searchableText: string;
}

export function createFixtureSearchSource(fixtures: readonly SearchFixture[]): SearchSource {
  return {
    search(input) {
      const query = normalizeSearchQuery(input.query).toLocaleLowerCase();
      if (query === '') return Promise.resolve([]);
      return Promise.resolve(
        fixtures
          .filter(
            (fixture) =>
              fixture.locale === input.locale &&
              fixture.surface === input.surface &&
              fixture.audience === input.audience &&
              [fixture.title, fixture.summary, fixture.searchableText].some((text) =>
                text.toLocaleLowerCase().includes(query),
              ),
          )
          .map(({ publicId, title, summary }) => ({ publicId, title, summary })),
      );
    },
  };
}
