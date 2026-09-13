import { createFileRoute, notFound, redirect } from '@tanstack/react-router';

import { EntryCollection } from '../components/entry-collection';
import { PublishingUnavailable } from '../components/publishing-unavailable';
import { UI } from '../i18n';
import { NO_STORE } from '../lib/cache-policy';
import { loadEntriesPage } from '../lib/publishing-loaders';
import { entriesPath, localelessPath, parsePageParam } from '../lib/publishing-routes';
import { publishingPageHeaders } from '../lib/publishing-status';
import { documentHead, failureHead } from '../lib/seo';
import { brandTitle } from '../lib/title';

/*
 * `/{lang}/entries/page/{N}/` for N >= 2.
 *
 * `{N}` is untrusted input and is decided before Rails is asked anything:
 *
 * - `1` is a real page with a different canonical URL, so it is a permanent
 *   redirect to `/{lang}/entries/`.
 * - Anything that is not a canonical integer >= 2 (`0`, `-1`, `01`, `1.5`,
 *   `foo`) is not a page: the not-found document, never page 1.
 *
 * Rails is then asked for exactly page N. Each page is its own canonical URL —
 * page 2 is never canonicalized to page 1.
 */
export const Route = createFileRoute('/$lang/entries/page/$page')({
  loader: async ({ params }) => {
    const parsed = parsePageParam(params.page);
    if (parsed.kind === 'first')
      throw redirect({ href: entriesPath(params.lang), statusCode: 301 });
    if (parsed.kind === 'invalid') throw notFound();
    const view = await loadEntriesPage(params.lang, parsed.page);
    if (view.kind === 'not-found') throw notFound();
    return view;
  },
  head: ({ params, loaderData }) => {
    const t = UI[params.lang];
    if (loaderData?.kind === 'ok') {
      return documentHead({
        locale: params.lang,
        title: brandTitle(t.entriesPageTitle(loaderData.page.current)),
        description: t.entriesDescription,
        path: localelessPath(params.lang, entriesPath(params.lang, loaderData.page.current)),
      });
    }
    return loaderData ? failureHead(brandTitle(t.unavailableTitle)) : {};
  },
  headers: ({ loaderData }) => publishingPageHeaders(loaderData, NO_STORE),
  component: EntriesPage,
});

function EntriesPage() {
  const { lang } = Route.useParams();
  const view = Route.useLoaderData();
  return view.kind === 'ok' ? (
    <EntryCollection locale={lang} view={view} />
  ) : (
    <PublishingUnavailable locale={lang} status={view.status} />
  );
}
