import type { Locale } from '../i18n';
import { getEdgeBindings, type EdgeBindings } from './env';
import { PUBLISHING_AUDIENCE, PUBLISHING_SURFACE } from './publishing-cell';
import type { PublishingCell } from './publishing-model';
import { getRailsClient, type RailsClient } from './rails-client';
import {
  createRailsEntriesClient,
  type FetchEntriesPageOptions,
  type RailsEntriesPage,
  type RailsEntriesResult,
  type RailsEntry,
} from './rails-entries';

/*
 * The Publishing read API as this cell sees it: the Rails entries client plus
 * the two checks that keep one cell's content out of another's pages.
 *
 * - Cell. Every Entry must belong to this unit's cell. Rails names the surface
 *   `namespace` and the audience `surface`; a mismatch on either is an
 *   `invalid-contract`, never a render.
 * - Locale. Every Entry must be in the locale the URL asked for, so a Rails
 *   fallback can never put English copy on a `/ja/` URL (or into its cache
 *   entry).
 */

export type PublishingResult<T> =
  | RailsEntriesResult<T>
  | { kind: 'not-configured' }
  | { kind: 'internal-error' };

export const THIS_CELL: PublishingCell = {
  surface: PUBLISHING_SURFACE,
  audience: PUBLISHING_AUDIENCE,
};

export function belongsToPublishingCell(
  entry: Pick<RailsEntry, 'namespace' | 'surface'>,
  cell: PublishingCell,
): boolean {
  return entry.namespace === cell.surface && entry.surface === cell.audience;
}

function acceptEntries<T>(
  result: RailsEntriesResult<T>,
  entries: (value: T) => readonly RailsEntry[],
  cell: PublishingCell,
  locale: Locale,
): RailsEntriesResult<T> {
  if (result.kind !== 'ok') return result;
  for (const entry of entries(result.value)) {
    if (!belongsToPublishingCell(entry, cell) || entry.locale !== locale) {
      return { kind: 'invalid-contract', upstreamStatus: result.upstreamStatus };
    }
  }
  return result;
}

/**
 * Outward HTTP status for a failed Publishing read. Upstream detail never
 * reaches the response body; only the status class does.
 */
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
    case 'upstream-error':
      // Rails throttling is a temporary unavailability of this page, not a
      // defect; every other upstream answer (401/403/3xx/5xx) is a bad gateway.
      return result.upstreamStatus === 429 ? 503 : 502;
  }
}

/**
 * Optional display text from an Entry `body` object. The public contract does
 * not guarantee `body.text`; when that key is a non-empty string it is shown,
 * otherwise the structured object is left uninterpreted.
 */
export function optionalEntryBodyText(body: Record<string, unknown>): string | null {
  const text = body['text'];
  return typeof text === 'string' && text.length > 0 ? text : null;
}

export function createPublishingApi(rails: RailsClient, cell: PublishingCell = THIS_CELL) {
  const entries = createRailsEntriesClient(rails);
  return {
    async fetchEntriesPage(
      options: FetchEntriesPageOptions,
    ): Promise<RailsEntriesResult<RailsEntriesPage>> {
      return acceptEntries(
        await entries.fetchEntriesPage(options),
        (page) => page.data,
        cell,
        options.locale,
      );
    },
    async fetchEntry(publicId: string, locale: Locale): Promise<RailsEntriesResult<RailsEntry>> {
      return acceptEntries(
        await entries.fetchEntry({ publicId, locale }),
        (entry) => [entry],
        cell,
        locale,
      );
    },
  };
}

export type PublishingApi = ReturnType<typeof createPublishingApi>;

export function resolvePublishingApi(
  env: EdgeBindings = getEdgeBindings(),
): PublishingApi | { kind: 'not-configured' } | { kind: 'internal-error' } {
  try {
    const rails = getRailsClient(env);
    if (!rails) return { kind: 'not-configured' };
    return createPublishingApi(rails);
  } catch {
    return { kind: 'internal-error' };
  }
}
