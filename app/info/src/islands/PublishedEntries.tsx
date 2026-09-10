import { useEffect, useState } from 'react';

import {
  parsePublishedEntriesPage,
  publishedEntriesUrl,
  publishedEntryHref,
  type PublishedEntriesPage,
  type PublishedLocale,
} from '../lib/publishing-browser';

interface Props {
  locale: PublishedLocale;
}

const COPY = {
  ja: {
    heading: '公開エントリー',
    loading: '読み込み中…',
    empty: '公開エントリーはまだありません。',
    error: 'エントリーを読み込めませんでした。',
    next: '次のページ',
  },
  en: {
    heading: 'Published entries',
    loading: 'Loading…',
    empty: 'No published entries yet.',
    error: 'Unable to load entries.',
    next: 'Next page',
  },
} as const;

export default function PublishedEntries({ locale }: Props) {
  const copy = COPY[locale];
  const [page, setPage] = useState<PublishedEntriesPage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void fetch(publishedEntriesUrl(locale, cursor), { credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return parsePublishedEntriesPage(await response.json());
      })
      .then((parsed) => {
        if (cancelled) return undefined;
        if (parsed === null) {
          setStatus('error');
          return undefined;
        }
        setPage(parsed);
        setStatus('ok');
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [locale, cursor]);

  return (
    <section className="mx-auto grid w-full max-w-4xl gap-4 px-6 pb-12" aria-live="polite">
      <h2 className="text-2xl font-semibold">{copy.heading}</h2>
      {status === 'loading' && <p>{copy.loading}</p>}
      {status === 'error' && <p>{copy.error}</p>}
      {status === 'ok' && page !== null && page.data.length === 0 && <p>{copy.empty}</p>}
      {status === 'ok' && page !== null && page.data.length > 0 && (
        <ul className="grid gap-4">
          {page.data.map((entry) => (
            <li key={entry.public_id}>
              <a
                className="text-lg font-medium underline"
                href={publishedEntryHref(locale, entry.public_id)}
              >
                {entry.title}
              </a>
              {entry.summary ? <p className="text-gray-700">{entry.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {status === 'ok' && page?.page.has_more && page.page.next_cursor ? (
        <p>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => {
              setCursor(page.page.next_cursor ?? undefined);
            }}
          >
            {copy.next}
          </button>
        </p>
      ) : null}
    </section>
  );
}
