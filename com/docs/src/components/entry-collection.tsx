import { UI, type Locale } from '../i18n';
import type { EntriesPageView } from '../lib/publishing-data';

type Loaded = Extract<EntriesPageView, { kind: 'ok' }>;

/**
 * One page of the entry collection: the list, the Rails management link, and
 * Previous / Next.
 *
 * Every URL arrives already built (`src/lib/publishing-data.ts`), so this
 * component cannot produce `/page/1/` or a slug-based link. The management link
 * is always rendered — Rails, not this page, decides who may use it.
 */
export function EntryCollection({ locale, view }: Readonly<{ locale: Locale; view: Loaded }>) {
  const t = UI[locale];
  const { previousHref, nextHref } = view.page;

  return (
    <main
      className="mx-auto grid w-full max-w-4xl flex-1 content-start gap-6 px-6 py-12"
      id="main-content"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-3xl leading-heading font-semibold">{t.entriesHeading}</h1>
        <a className="text-brand underline" href={view.manageHref}>
          {t.manage}
        </a>
      </div>
      {view.entries.length === 0 ? (
        <p>{t.entriesEmpty}</p>
      ) : (
        <ul className="grid gap-4">
          {view.entries.map((entry) => (
            <li className="rounded-lg border border-gray-200 bg-white p-4" key={entry.publicId}>
              <a className="text-lg font-medium underline" href={entry.href}>
                {entry.title}
              </a>
              {entry.summary !== null && entry.summary !== '' && (
                <p className="text-gray-700">{entry.summary}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {(previousHref !== null || nextHref !== null) && (
        <nav aria-label={t.pagination}>
          <ul className="flex flex-wrap gap-4">
            {previousHref !== null && (
              <li>
                <a
                  className="inline-flex min-h-11 items-center underline"
                  href={previousHref}
                  rel="prev"
                >
                  {t.previous}
                </a>
              </li>
            )}
            {nextHref !== null && (
              <li>
                <a
                  className="inline-flex min-h-11 items-center underline"
                  href={nextHref}
                  rel="next"
                >
                  {t.next}
                </a>
              </li>
            )}
          </ul>
        </nav>
      )}
    </main>
  );
}
