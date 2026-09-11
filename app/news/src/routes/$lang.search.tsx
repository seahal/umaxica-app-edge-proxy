import { createFileRoute } from '@tanstack/react-router';

import { UI } from '../i18n';
import { loadSearchResults } from '../lib/publishing-loaders';
import { entryPath, searchPath } from '../lib/publishing-routes';
import { normalizeSearchQuery } from '../lib/search/search-source';
import { documentHead } from '../lib/seo';
import { brandTitle } from '../lib/title';

/*
 * `/{lang}/search/?q=…` — present on all twelve units.
 *
 * The route depends on the `SearchSource` abstraction only, through the
 * server-only `loadSearchResults`. Today that source is TEMPORARY fixture data
 * (`src/lib/search/current-source.ts`); the page says so. The query is always
 * scoped to this unit's cell and the URL locale, so results never cross a
 * surface, an audience or a language.
 *
 * A plain GET form: submitting it is a full document request, so the page works
 * without JavaScript and the query is in the URL. Results link to the Entry by
 * `public_id` in the same locale. No cache strategy in this phase, and a results
 * page is kept out of the index.
 */
export const Route = createFileRoute('/$lang/search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const q = search['q'];
    return typeof q === 'string' ? { q } : {};
  },
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: async ({ params, deps }) => {
    const query = normalizeSearchQuery(deps.q);
    const results = await loadSearchResults(params.lang, query);
    return {
      query,
      results: results.map((result) => ({
        ...result,
        href: entryPath(params.lang, result.publicId),
      })),
    };
  },
  head: ({ params, loaderData }) =>
    documentHead({
      locale: params.lang,
      title: brandTitle(UI[params.lang].searchTitle),
      description: UI[params.lang].searchDescription,
      path: '/search/',
      noindex: (loaderData?.query ?? '') !== '',
    }),
  component: SearchPage,
});

function SearchPage() {
  const { lang } = Route.useParams();
  const { query, results } = Route.useLoaderData();
  const t = UI[lang];

  return (
    <main
      className="mx-auto grid w-full max-w-4xl flex-1 content-start gap-6 px-6 py-12"
      id="main-content"
      tabIndex={-1}
    >
      <h1 className="text-3xl leading-heading font-semibold">{t.searchHeading}</h1>
      <search>
        <form action={searchPath(lang)} className="flex flex-wrap items-end gap-3" method="get">
          <label className="grid gap-1" htmlFor="search-query">
            <span className="text-sm font-medium">{t.searchLabel}</span>
            <input
              className="min-h-11 w-72 max-w-full rounded-md border border-gray-300 bg-white px-3"
              defaultValue={query}
              id="search-query"
              maxLength={200}
              name="q"
              type="search"
            />
          </label>
          <button
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-gray-300 bg-white px-4 hover:bg-gray-100"
            type="submit"
          >
            {t.searchSubmit}
          </button>
        </form>
      </search>
      <p className="text-sm text-gray-600">{t.searchTemporaryNotice}</p>
      {query === '' ? (
        <p>{t.searchPrompt}</p>
      ) : results.length === 0 ? (
        <p>{t.searchNoResults(query)}</p>
      ) : (
        <section aria-labelledby="search-results-heading" className="grid gap-4">
          <h2 className="text-xl font-semibold" id="search-results-heading">
            {t.searchResultCount(results.length, query)}
          </h2>
          <ul className="grid gap-4">
            {results.map((result) => (
              <li className="rounded-lg border border-gray-200 bg-white p-4" key={result.publicId}>
                <a className="text-lg font-medium underline" href={result.href}>
                  {result.title}
                </a>
                <p className="text-gray-700">{result.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
