import type { Locale } from '../i18n';
import { readBoundedText } from './bounded-text';
import type { RailsClient, RailsClientResult } from './rails-client';

/*
 * The consumer of Rails' public Publishing read API:
 *
 *   GET /api/v0/entries?locale={ja|en}[&page=N]
 *   GET /api/v0/entries/{public_id}?locale={ja|en}
 *
 * Rails owns pagination (Pagy) and the resource identity (`public_id`). This
 * file never computes an offset, never crawls pages, and never looks an Entry
 * up by slug.
 *
 * Every 2xx body is validated before anything reaches a page. Validation is
 * hand-written rather than a schema library because it is the whole of this
 * unit's schema surface and the repository's other consumers (`rails-health.ts`)
 * already read JSON this way. Only the fields named below survive parsing —
 * additive Rails fields are tolerated and dropped, so nothing unvalidated can be
 * serialized into a page.
 */

/** A JSON body larger than this is a contract violation, not a slow page. */
export const RAILS_JSON_MAX_CHARS = 1_048_576;

export interface RailsEntry {
  public_id: string;
  /** Rails' name for this unit's surface (docs / help / info / news). */
  namespace: string;
  /** Rails' name for this unit's audience (app / com / org). */
  surface: string;
  slug: string;
  locale: Locale;
  title: string;
  summary: string | null;
  // Rails guarantees `body` as an object, not a frozen CMS schema.
  body: Record<string, unknown>;
  published_at: string;
  taxonomy: Record<string, unknown>;
}

export interface RailsPageInfo {
  current: number;
  previous: number | null;
  next: number | null;
  last: number;
}

export interface RailsEntriesPage {
  data: RailsEntry[];
  page: RailsPageInfo;
}

export type RailsEntriesResult<T> =
  | { kind: 'ok'; value: T; upstreamStatus: number }
  | { kind: 'not-found'; upstreamStatus: 404 }
  | { kind: 'upstream-error'; upstreamStatus?: number }
  | { kind: 'unreachable' }
  | { kind: 'timeout' }
  | { kind: 'invalid-contract'; upstreamStatus?: number };

export interface FetchEntriesPageOptions {
  locale: Locale;
  page?: number;
}

export interface FetchEntryOptions {
  publicId: string;
  locale: Locale;
}

export interface RailsEntriesClient {
  fetchEntriesPage(options: FetchEntriesPageOptions): Promise<RailsEntriesResult<RailsEntriesPage>>;
  fetchEntry(options: FetchEntryOptions): Promise<RailsEntriesResult<RailsEntry>>;
}

const TIMEZONE_AWARE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPageNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    TIMEZONE_AWARE_TIMESTAMP.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function parseRailsEntry(value: unknown): RailsEntry | null {
  if (!isRecord(value)) return null;
  const {
    public_id: publicId,
    namespace,
    surface,
    slug,
    locale,
    title,
    summary,
    body,
    published_at: publishedAt,
    taxonomy,
  } = value;
  if (
    !isNonEmptyString(publicId) ||
    !isNonEmptyString(namespace) ||
    !isNonEmptyString(surface) ||
    !isNonEmptyString(slug) ||
    (locale !== 'ja' && locale !== 'en') ||
    !isNonEmptyString(title) ||
    (summary !== null && typeof summary !== 'string') ||
    !isRecord(body) ||
    !isTimestamp(publishedAt) ||
    !isRecord(taxonomy)
  ) {
    return null;
  }
  return {
    public_id: publicId,
    namespace,
    surface,
    slug,
    locale,
    title,
    summary,
    body,
    published_at: publishedAt,
    taxonomy,
  };
}

export function parseRailsEntriesPage(value: unknown): RailsEntriesPage | null {
  if (!isRecord(value) || !Array.isArray(value['data']) || !isRecord(value['page'])) return null;
  const { current, previous, next, last } = value['page'];
  if (
    !isPageNumber(current) ||
    !isPageNumber(last) ||
    (previous !== null && !isPageNumber(previous)) ||
    (next !== null && !isPageNumber(next))
  ) {
    return null;
  }
  const data: RailsEntry[] = [];
  for (const candidate of value['data']) {
    const entry = parseRailsEntry(candidate);
    if (entry === null) return null;
    data.push(entry);
  }
  return { data, page: { current, previous, next, last } };
}

function entriesPath(options: FetchEntriesPageOptions): string | null {
  if (options.page !== undefined && (!Number.isInteger(options.page) || options.page < 1)) {
    return null;
  }

  const query = new URLSearchParams({ locale: options.locale });
  if (options.page !== undefined) query.set('page', String(options.page));
  return `/api/v0/entries?${query.toString()}`;
}

/**
 * The body as JSON, or `invalid` when it is empty, oversized or not JSON. A
 * declared `Content-Length` above the limit is refused before the body is read;
 * an undeclared one is read only up to the limit.
 */
async function readJson(
  response: Response,
): Promise<{ kind: 'ok'; value: unknown } | { kind: 'invalid' }> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > RAILS_JSON_MAX_CHARS) return { kind: 'invalid' };
  try {
    const text = await readBoundedText(response.clone(), RAILS_JSON_MAX_CHARS + 1);
    if (text.length > RAILS_JSON_MAX_CHARS) return { kind: 'invalid' };
    const value: unknown = JSON.parse(text);
    return { kind: 'ok', value };
  } catch {
    return { kind: 'invalid' };
  }
}

async function map<T>(
  result: RailsClientResult,
  parse: (value: unknown) => T | null,
): Promise<RailsEntriesResult<T>> {
  if (result.kind === 'timeout') return { kind: 'timeout' };
  if (result.kind === 'unreachable') return { kind: 'unreachable' };
  if (result.kind === 'invalid-path') return { kind: 'upstream-error' };
  if (result.kind === 'http-error') {
    if (result.status === 404) return { kind: 'not-found', upstreamStatus: 404 };
    return { kind: 'upstream-error', upstreamStatus: result.status };
  }

  const decoded = await readJson(result.response);
  if (decoded.kind === 'invalid') {
    return { kind: 'invalid-contract', upstreamStatus: result.status };
  }
  const parsed = parse(decoded.value);
  return parsed === null
    ? { kind: 'invalid-contract', upstreamStatus: result.status }
    : { kind: 'ok', value: parsed, upstreamStatus: result.status };
}

export function createRailsEntriesClient(rails: RailsClient): RailsEntriesClient {
  return {
    async fetchEntriesPage(options) {
      const path = entriesPath(options);
      if (path === null) return { kind: 'invalid-contract' };
      return map(
        await rails.fetch(path, { headers: { Accept: 'application/json' } }),
        parseRailsEntriesPage,
      );
    },

    async fetchEntry({ publicId, locale }) {
      const query = new URLSearchParams({ locale });
      return map(
        await rails.fetch(`/api/v0/entries/${encodeURIComponent(publicId)}?${query.toString()}`, {
          headers: { Accept: 'application/json' },
        }),
        parseRailsEntry,
      );
    },
  };
}
