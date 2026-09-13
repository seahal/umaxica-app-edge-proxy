import { createFileRoute, notFound } from '@tanstack/react-router';

import { EntryCollection } from '../components/entry-collection';
import { PublishingUnavailable } from '../components/publishing-unavailable';
import { UI } from '../i18n';
import { NO_STORE } from '../lib/cache-policy';
import { loadEntriesPage } from '../lib/publishing-loaders';
import { publishingPageHeaders } from '../lib/publishing-status';
import { documentHead, failureHead } from '../lib/seo';
import { brandTitle } from '../lib/title';

/*
 * `/{lang}/entries/` — page 1 of the collection, and page 1's canonical URL.
 *
 * SSR only: the loader asks Rails for exactly this page (`locale={lang}`, no
 * `page`), server-side, through a server-only function. No cache strategy in
 * this phase — the collection keeps the `no-store` it has always sent.
 */
export const Route = createFileRoute('/$lang/entries/')({
  loader: async ({ params }) => {
    const view = await loadEntriesPage(params.lang, 1);
    if (view.kind === 'not-found') throw notFound();
    return view;
  },
  head: ({ params, loaderData }) => {
    const t = UI[params.lang];
    if (loaderData?.kind === 'ok') {
      return documentHead({
        locale: params.lang,
        title: brandTitle(t.entriesTitle),
        description: t.entriesDescription,
        path: '/entries/',
      });
    }
    return loaderData ? failureHead(brandTitle(t.unavailableTitle)) : {};
  },
  headers: ({ loaderData }) => publishingPageHeaders(loaderData, NO_STORE),
  component: EntriesIndex,
});

function EntriesIndex() {
  const { lang } = Route.useParams();
  const view = Route.useLoaderData();
  return view.kind === 'ok' ? (
    <EntryCollection locale={lang} view={view} />
  ) : (
    <PublishingUnavailable locale={lang} status={view.status} />
  );
}
