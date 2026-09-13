import '@tanstack/react-start/server-only';
import type { Locale } from '../i18n';
import { getEdgeBindings, type EdgeBindings } from './env';
import {
  optionalEntryBodyText,
  publishingHttpStatus,
  resolvePublishingApi,
  THIS_CELL,
  type PublishingResult,
} from './publishing-api';
import { managementEditUrl, managementIndexUrl } from './publishing-management';
import { entriesPath, entryPath } from './publishing-routes';

/*
 * What a Publishing page receives: a view model built on the server from a
 * validated Rails response.
 *
 * A route loader's return value is serialized into the HTML for hydration, so
 * this is also the exact set of Rails data that reaches the browser. It carries
 * display fields and public URLs only — never the Entry `body` object, the
 * taxonomy, an upstream status or error text, and never the private Rails host.
 *
 * A Rails 404 is `not-found` (the route throws the router's not-found signal);
 * every other failure is `error` with the outward status the route applies.
 */

export interface EntrySummaryView {
  publicId: string;
  title: string;
  summary: string | null;
  href: string;
}

export type EntriesPageView =
  | {
      kind: 'ok';
      entries: EntrySummaryView[];
      page: { current: number; last: number; previousHref: string | null; nextHref: string | null };
      manageHref: string;
    }
  | { kind: 'not-found' }
  | { kind: 'error'; status: number };

export interface EntryDetailView {
  publicId: string;
  title: string;
  summary: string | null;
  bodyText: string | null;
  publishedAt: string;
}

export type EntryView =
  | { kind: 'ok'; entry: EntryDetailView; editHref: string }
  | { kind: 'not-found' }
  | { kind: 'error'; status: number };

function failure(
  result: PublishingResult<unknown>,
): { kind: 'not-found' } | { kind: 'error'; status: number } {
  const status = publishingHttpStatus(result);
  return status === 404 ? { kind: 'not-found' } : { kind: 'error', status };
}

const INTERNAL_ERROR = { kind: 'error', status: 500 } as const;

/** One collection page. `page` has already been validated as >= 1 by the route. */
export async function readEntriesPage(
  locale: Locale,
  page: number,
  env: EdgeBindings = getEdgeBindings(),
): Promise<EntriesPageView> {
  try {
    const api = resolvePublishingApi(env);
    if ('kind' in api) return failure(api);

    const result = await api.fetchEntriesPage(page === 1 ? { locale } : { locale, page });
    if (result.kind !== 'ok') return failure(result);

    const { data, page: info } = result.value;
    // Rails owns pagination. A page Rails does not confirm as the one asked for
    // (clamped, past the end) is not a page at this URL.
    if (info.current !== page) return { kind: 'not-found' };

    return {
      kind: 'ok',
      entries: data.map((entry) => ({
        publicId: entry.public_id,
        title: entry.title,
        summary: entry.summary,
        href: entryPath(locale, entry.public_id),
      })),
      page: {
        current: info.current,
        last: info.last,
        previousHref: info.previous === null ? null : entriesPath(locale, info.previous),
        nextHref: info.next === null ? null : entriesPath(locale, info.next),
      },
      manageHref: managementIndexUrl(env.RAILS_STAFF_BASE_ORIGIN ?? '', THIS_CELL),
    };
  } catch {
    return INTERNAL_ERROR;
  }
}

/** One Entry by `public_id`, in the URL's locale, from this cell only. */
export async function readEntry(
  locale: Locale,
  publicId: string,
  env: EdgeBindings = getEdgeBindings(),
): Promise<EntryView> {
  try {
    const api = resolvePublishingApi(env);
    if ('kind' in api) return failure(api);

    const result = await api.fetchEntry(publicId, locale);
    if (result.kind !== 'ok') return failure(result);

    const entry = result.value;
    return {
      kind: 'ok',
      entry: {
        publicId: entry.public_id,
        title: entry.title,
        summary: entry.summary,
        bodyText: optionalEntryBodyText(entry.body),
        publishedAt: entry.published_at,
      },
      editHref: managementEditUrl(env.RAILS_STAFF_BASE_ORIGIN ?? '', THIS_CELL, entry.public_id),
    };
  } catch {
    return INTERNAL_ERROR;
  }
}
