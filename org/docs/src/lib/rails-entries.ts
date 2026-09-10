import { z } from 'astro/zod';

import type { RailsClient, RailsClientResult } from './rails-client';

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

const pageNumberSchema = z.number().int().positive();

export const railsEntriesPageSchema = z
  .object({
    data: z.array(railsEntrySchema),
    page: z
      .object({
        current: pageNumberSchema,
        previous: pageNumberSchema.nullable(),
        next: pageNumberSchema.nullable(),
        last: pageNumberSchema,
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
  page?: number;
}

export interface FetchEntryOptions {
  publicId: string;
  locale: RailsEntry['locale'];
}

export interface RailsEntriesClient {
  fetchEntriesPage(options: FetchEntriesPageOptions): Promise<RailsEntriesResult<RailsEntriesPage>>;
  fetchEntry(options: FetchEntryOptions): Promise<RailsEntriesResult<RailsEntry>>;
}

function entriesPath(options: FetchEntriesPageOptions): string | null {
  if (options.page !== undefined && (!Number.isInteger(options.page) || options.page < 1)) {
    return null;
  }

  const query = new URLSearchParams({ locale: options.locale });
  if (options.page !== undefined) query.set('page', String(options.page));
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
 * Rails API identity is `public_id`. The public Astro URL uses the same
 * identity: `/{lang}/entries/{public_id}/`. Edge never calculates SQL OFFSET;
 * page numbers are forwarded to Rails (Pagy) as `page`.
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
