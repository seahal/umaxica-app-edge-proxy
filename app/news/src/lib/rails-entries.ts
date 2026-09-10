import { z } from 'astro/zod';

import type { RailsClient, RailsClientResult } from './rails-client';

const MAX_ALL_ENTRIES_PAGES = 100;
const MAX_ENTRIES_PAGE_LIMIT = 100;

export const railsEntrySchema = z
  .object({
    public_id: z.string().min(1),
    namespace: z.string().min(1),
    surface: z.string().min(1),
    slug: z.string().min(1),
    locale: z.enum(['ja', 'en']),
    title: z.string().min(1),
    summary: z.string().nullable(),
    // Rails currently guarantees `body` as an object, not a frozen CMS schema.
    // `body.text` may appear in seed data; it is not required here.
    body: z.object({}).loose(),
    published_at: z.iso.datetime({ offset: true }),
    taxonomy: z.record(z.string(), z.unknown()),
  })
  .loose();

export const railsEntriesPageSchema = z
  .object({
    data: z.array(railsEntrySchema),
    page: z
      .object({
        next_cursor: z.string().min(1).nullable(),
        has_more: z.boolean(),
      })
      .loose(),
  })
  .loose();

export type RailsEntry = z.infer<typeof railsEntrySchema>;
export type RailsEntriesPage = z.infer<typeof railsEntriesPageSchema>;
export type RailsEntriesResult<T> =
  | { kind: 'ok'; value: T; upstreamStatus: number }
  | { kind: 'not-found'; upstreamStatus: 404 }
  | { kind: 'upstream-error'; upstreamStatus?: number }
  | { kind: 'unreachable' }
  | { kind: 'timeout' }
  | { kind: 'invalid-contract'; upstreamStatus?: number };

export interface FetchEntriesPageOptions {
  locale: RailsEntry['locale'];
  limit?: number;
  cursor?: string;
}

export interface FetchEntryOptions {
  publicId: string;
  locale: RailsEntry['locale'];
}

export interface RailsEntriesClient {
  fetchEntriesPage(options: FetchEntriesPageOptions): Promise<RailsEntriesResult<RailsEntriesPage>>;
  fetchAllEntries(
    options: Pick<FetchEntriesPageOptions, 'locale'>,
  ): Promise<RailsEntriesResult<RailsEntry[]>>;
  fetchEntry(options: FetchEntryOptions): Promise<RailsEntriesResult<RailsEntry>>;
}

function entriesPath(options: FetchEntriesPageOptions): string | null {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_ENTRIES_PAGE_LIMIT)
  ) {
    return null;
  }

  const query = new URLSearchParams({ locale: options.locale });
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  return `/api/v0/entries?${query.toString()}`;
}

async function parseJson(
  response: Response,
): Promise<{ kind: 'ok'; value: unknown } | { kind: 'invalid' }> {
  try {
    return { kind: 'ok', value: await response.clone().json() };
  } catch {
    return { kind: 'invalid' };
  }
}

function isTimeout(
  result: RailsClientResult,
): result is Extract<RailsClientResult, { kind: 'timeout' }> {
  /*
   * `'timeout'` is not a member of `RailsClientResult['kind']` in this file's
   * own types — it is Astro's own transport signal, layered on top of the
   * Rails client's result union by `rails-client.ts` at the seam this guard
   * reads. `Reflect.get` is what asks the object rather than the type: typed
   * through `unknown` so the literal-key overload cannot narrow the return to
   * a union the compiler already believes excludes 'timeout', which is
   * exactly the comparison this guard exists to make.
   */
  const kind: unknown = Reflect.get(result, 'kind');
  return kind === 'timeout';
}

async function map<T>(
  result: RailsClientResult,
  schema: z.ZodType<T>,
): Promise<RailsEntriesResult<T>> {
  if (isTimeout(result)) return { kind: 'timeout' };
  if (result.kind === 'unreachable') return { kind: 'unreachable' };
  if (result.kind === 'invalid-path') return { kind: 'upstream-error' };
  if (result.kind === 'http-error') {
    if (result.status === 404) return { kind: 'not-found', upstreamStatus: 404 };
    return { kind: 'upstream-error', upstreamStatus: result.status };
  }

  const decoded = await parseJson(result.response);
  if (decoded.kind === 'invalid') {
    return { kind: 'invalid-contract', upstreamStatus: result.status };
  }
  const parsed = schema.safeParse(decoded.value);
  return parsed.success
    ? { kind: 'ok', value: parsed.data, upstreamStatus: result.status }
    : { kind: 'invalid-contract', upstreamStatus: result.status };
}

/**
 * Rails API identity is `public_id`. The Astro public URL is intentionally
 * undecided: this client must not make an API path a page-route invariant.
 */
export function createRailsEntriesClient(rails: RailsClient): RailsEntriesClient {
  return {
    async fetchEntriesPage(options) {
      const path = entriesPath(options);
      if (path === null) return { kind: 'invalid-contract' };
      return map(
        await rails.fetch(path, { headers: { Accept: 'application/json' } }),
        railsEntriesPageSchema,
      );
    },

    async fetchAllEntries({ locale }) {
      const entries: RailsEntry[] = [];
      let cursor: string | undefined;

      for (let requestCount = 0; requestCount < MAX_ALL_ENTRIES_PAGES; requestCount += 1) {
        const pageResult = await this.fetchEntriesPage(
          cursor === undefined ? { locale } : { locale, cursor },
        );
        if (pageResult.kind !== 'ok') return pageResult;

        entries.push(...pageResult.value.data);
        const { has_more: hasMore, next_cursor: nextCursor } = pageResult.value.page;
        if (!hasMore)
          return { kind: 'ok', value: entries, upstreamStatus: pageResult.upstreamStatus };
        if (nextCursor === null)
          return { kind: 'invalid-contract', upstreamStatus: pageResult.upstreamStatus };
        cursor = nextCursor;
      }

      return { kind: 'invalid-contract' };
    },

    async fetchEntry({ publicId, locale }) {
      const query = new URLSearchParams({ locale });
      return map(
        await rails.fetch(`/api/v0/entries/${encodeURIComponent(publicId)}?${query.toString()}`, {
          headers: { Accept: 'application/json' },
        }),
        railsEntrySchema,
      );
    },
  };
}
