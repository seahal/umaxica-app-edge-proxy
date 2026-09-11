import { createFileRoute, notFound } from '@tanstack/react-router';

import { PublishingUnavailable } from '../components/publishing-unavailable';
import { UI } from '../i18n';
import { ENTRY_CACHE_CONTROL } from '../lib/cache-policy';
import { loadEntry } from '../lib/publishing-loaders';
import { entryPath, localelessPath } from '../lib/publishing-routes';
import { publishingPageHeaders } from '../lib/publishing-status';
import { documentHead, failureHead } from '../lib/seo';
import { brandTitle } from '../lib/title';

/*
 * `/{lang}/entries/{public_id}/` — one Entry, looked up in Rails by `public_id`
 * and the URL locale, and accepted only if it belongs to this cell.
 *
 * The ONE route on this unit with an explicit public cache policy, and only
 * when it rendered an Entry: `ENTRY_CACHE_CONTROL` from `src/lib/cache-policy.ts`.
 * A not-found or failure answer is `no-store`. The cache key is the URL, which
 * already carries the host (cell), the locale and the `public_id`.
 *
 * The edit link is always rendered and points at the Rails staff origin by
 * `public_id`; Rails decides whether the visitor may use it.
 */
export const Route = createFileRoute('/$lang/entries/$publicId')({
  loader: async ({ params }) => {
    const view = await loadEntry(params.lang, params.publicId);
    if (view.kind === 'not-found') throw notFound();
    return view;
  },
  head: ({ params, loaderData }) => {
    if (loaderData?.kind === 'ok') {
      const { entry } = loaderData;
      return documentHead({
        locale: params.lang,
        title: brandTitle(entry.title),
        description: entry.summary ?? entry.title,
        path: localelessPath(params.lang, entryPath(params.lang, entry.publicId)),
      });
    }
    return loaderData ? failureHead(brandTitle(UI[params.lang].unavailableTitle)) : {};
  },
  headers: ({ loaderData }) => publishingPageHeaders(loaderData, ENTRY_CACHE_CONTROL),
  component: EntryPage,
});

function EntryPage() {
  const { lang } = Route.useParams();
  const view = Route.useLoaderData();
  if (view.kind !== 'ok') return <PublishingUnavailable locale={lang} status={view.status} />;

  const t = UI[lang];
  const { entry, editHref } = view;
  return (
    <main
      className="mx-auto grid w-full max-w-4xl flex-1 content-start gap-6 px-6 py-12"
      id="main-content"
      tabIndex={-1}
    >
      <article className="grid gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-3xl leading-heading font-semibold">{entry.title}</h1>
          <a className="text-brand underline" href={editHref}>
            {t.edit}
          </a>
        </div>
        <p className="text-sm text-gray-600">
          {t.publishedAt}: <time dateTime={entry.publishedAt}>{entry.publishedAt}</time>
        </p>
        {entry.summary !== null && entry.summary !== '' && (
          <p className="text-lg text-gray-700">{entry.summary}</p>
        )}
        {entry.bodyText === null ? (
          <p className="text-gray-600">{t.entryBodyStructured}</p>
        ) : (
          <p className="whitespace-pre-wrap">{entry.bodyText}</p>
        )}
      </article>
    </main>
  );
}
