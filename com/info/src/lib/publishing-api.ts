import { getEdgeBindings, type EdgeBindings } from './env';
import { PUBLISHING_NAMESPACE, PUBLISHING_SURFACE } from './publishing-cell';
import { getRailsClient, type RailsClient } from './rails-client';
import {
  createRailsEntriesClient,
  type FetchEntriesPageOptions,
  type RailsEntriesPage,
  type RailsEntriesResult,
  type RailsEntry,
} from './rails-entries';

export type RailsLocale = 'ja' | 'en';

export type PublishingResult<T> =
  | { kind: 'ok'; value: T; upstreamStatus: number }
  | { kind: 'not-found'; upstreamStatus: 404 }
  | { kind: 'upstream-error'; upstreamStatus?: number }
  | { kind: 'unreachable' }
  | { kind: 'timeout' }
  | { kind: 'invalid-contract'; upstreamStatus?: number }
  | { kind: 'bad-request' }
  | { kind: 'not-configured' }
  | { kind: 'internal-error' };

export interface PublishingCell {
  namespace: string;
  surface: string;
}

export function railsLocaleFromPathLang(lang: string | undefined): RailsLocale | null {
  return lang === 'ja' || lang === 'en' ? lang : null;
}

export function entryPublicPath(lang: RailsLocale, publicId: string): string {
  return `/${lang}/entries/${encodeURIComponent(publicId)}/`;
}

export function entriesIndexPath(lang: RailsLocale, page?: number): string {
  if (page === undefined || page === 1) return `/${lang}/entries/`;
  const query = new URLSearchParams({ page: String(page) });
  return `/${lang}/entries/?${query.toString()}`;
}

export type PublicPageQuery =
  | { kind: 'omitted' }
  | { kind: 'ok'; page: number }
  | { kind: 'invalid' };

/**
 * Untrusted `?page=` from the public URL. Only a positive integer is accepted.
 * Malformed values are not rewritten to page 1.
 */
export function parsePublicPageQuery(raw: string | null): PublicPageQuery {
  if (raw === null) return { kind: 'omitted' };
  if (!/^[1-9][0-9]{0,8}$/u.test(raw)) return { kind: 'invalid' };
  return { kind: 'ok', page: Number(raw) };
}

export function belongsToPublishingCell(entry: RailsEntry, cell: PublishingCell): boolean {
  return entry.namespace === cell.namespace && entry.surface === cell.surface;
}

function isRailsEntry(value: unknown): value is RailsEntry {
  if (typeof value !== 'object' || value === null) return false;
  const namespace: unknown = Reflect.get(value, 'namespace');
  const surface: unknown = Reflect.get(value, 'surface');
  const publicId: unknown = Reflect.get(value, 'public_id');
  return (
    typeof namespace === 'string' && typeof surface === 'string' && typeof publicId === 'string'
  );
}

function cellForThisUnit(): PublishingCell {
  return { namespace: PUBLISHING_NAMESPACE, surface: PUBLISHING_SURFACE };
}

function rejectForeignCell<T extends RailsEntry | RailsEntriesPage>(
  result: RailsEntriesResult<T>,
  cell: PublishingCell,
): PublishingResult<T> {
  if (result.kind !== 'ok') return result;
  const value = result.value;
  const listed = Reflect.get(value, 'data');
  const candidates: unknown[] = Array.isArray(listed) ? listed : [value];
  for (const candidate of candidates) {
    if (!isRailsEntry(candidate) || !belongsToPublishingCell(candidate, cell)) {
      return { kind: 'invalid-contract', upstreamStatus: result.upstreamStatus };
    }
  }
  return result;
}

export function publishingHttpStatus(result: PublishingResult<unknown>): number {
  switch (result.kind) {
    case 'ok':
      return 200;
    case 'not-found':
      return 404;
    case 'timeout':
      return 504;
    case 'unreachable':
    case 'not-configured':
      return 503;
    case 'internal-error':
      return 500;
    case 'invalid-contract':
      return 502;
    case 'bad-request':
      return 400;
    case 'upstream-error':
      if (result.upstreamStatus === 429) return 503;
      if (result.upstreamStatus === 400 || result.upstreamStatus === 422) return 400;
      return 502;
  }
}

export function publishingErrorHeading(status: number, locale: RailsLocale): string {
  if (status === 404) {
    return locale === 'ja' ? 'ページが見つかりません' : 'Page not found';
  }
  return locale === 'ja' ? 'このページを表示できません' : 'Unable to display this page';
}

export function publishingErrorHtml(status: number, locale: RailsLocale): string {
  const heading = publishingErrorHeading(status, locale);
  return (
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">` +
    `<meta name="robots" content="noindex,nofollow"><title>${heading}</title></head>` +
    `<body><main><h1>${heading}</h1><p>HTTP ${String(status)}</p></main></body></html>`
  );
}

export function publishingErrorResponse(status: number, locale: RailsLocale): Response {
  return new Response(publishingErrorHtml(status, locale), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * Optional display text from an Entry `body` object. The public contract does
 * not guarantee `body.text`; when that key is a string it is shown, otherwise
 * the structured object is left uninterpreted.
 */
export function optionalEntryBodyText(body: object): string | null {
  const text: unknown = Reflect.get(body, 'text');
  return typeof text === 'string' && text.length > 0 ? text : null;
}

export function createPublishingApi(rails: RailsClient, cell: PublishingCell = cellForThisUnit()) {
  const entries = createRailsEntriesClient(rails);
  return {
    async fetchEntriesPage(
      options: FetchEntriesPageOptions,
    ): Promise<PublishingResult<RailsEntriesPage>> {
      return rejectForeignCell(await entries.fetchEntriesPage(options), cell);
    },
    async fetchEntry(publicId: string, locale: RailsLocale): Promise<PublishingResult<RailsEntry>> {
      return rejectForeignCell(await entries.fetchEntry({ publicId, locale }), cell);
    },
  };
}

export function resolvePublishingApi(
  env: EdgeBindings = getEdgeBindings(),
): ReturnType<typeof createPublishingApi> | PublishingResult<never> {
  try {
    const rails = getRailsClient(env);
    if (!rails) return { kind: 'not-configured' };
    return createPublishingApi(rails);
  } catch {
    return { kind: 'internal-error' };
  }
}
