import type { RailsClient, RailsClientResult } from '../rails-client';
import {
  CMS_RESPONSE_MAX_BYTES,
  type CmsFetchResult,
  type CmsLocale,
  parseCmsDocument,
  type TransportReason,
} from './document';

const REASONS: readonly Exclude<TransportReason, 'unknown'>[] = [
  'connection_limit_reached',
  'connection_refused',
  'connection_terminated',
  'connection_timeout',
  'destination_not_found',
  'destination_unavailable',
  'dns_error',
  'http_response_incomplete',
  'rate_limited',
  'tls_certificate_error',
];
// Cap slug→public_id index walks. A missing slug must not scan the full catalog.
const MAX_INDEX_PAGES = 3;
const INDEX_PAGE_LIMIT = 100;

function reason(message: string): TransportReason {
  const lower = message.toLowerCase();
  return REASONS.find((item) => lower.includes(item)) ?? 'unknown';
}

function isByteStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'getReader') === 'function'
  );
}

async function json(
  response: Response,
): Promise<{ kind: 'ok'; value: unknown } | { kind: 'invalid-json' } | { kind: 'too-large' }> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > CMS_RESPONSE_MAX_BYTES) return { kind: 'too-large' };
  const body: unknown = response.body;
  if (!isByteStream(body)) return { kind: 'invalid-json' };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let part = await reader.read();
  while (!part.done) {
    size += part.value.byteLength;
    if (size > CMS_RESPONSE_MAX_BYTES) {
      await reader.cancel();
      return { kind: 'too-large' };
    }
    chunks.push(part.value);
    part = await reader.read();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: 'ok', value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { kind: 'invalid-json' };
  }
}

function http(
  result: Extract<RailsClientResult, { kind: 'http-error' }>,
): Exclude<CmsFetchResult, { kind: 'ok' }> {
  const status = result.status;
  if (status === 404) return { kind: 'not-found', upstreamStatus: 404 };
  if (status === 401 || status === 403)
    return { kind: 'upstream-access-error', upstreamStatus: status };
  if (status === 429) return { kind: 'upstream-rate-limited', upstreamStatus: 429 };
  if (status >= 500 && status <= 599) return { kind: 'upstream-error', upstreamStatus: status };
  return { kind: 'upstream-protocol-error', upstreamStatus: status };
}

function contract(
  decoded: Awaited<ReturnType<typeof json>>,
  status: number,
): Extract<CmsFetchResult, { kind: 'invalid-contract' }> | { kind: 'ok'; value: unknown } {
  if (decoded.kind === 'too-large')
    return { kind: 'invalid-contract', reason: 'response_too_large', upstreamStatus: status };
  if (decoded.kind === 'invalid-json')
    return { kind: 'invalid-contract', reason: 'invalid_json', upstreamStatus: status };
  return { kind: 'ok', value: decoded.value };
}

async function mapTransport(
  result: RailsClientResult,
): Promise<
  { kind: 'payload'; status: number; value: unknown } | Exclude<CmsFetchResult, { kind: 'ok' }>
> {
  switch (result.kind) {
    case 'invalid-path':
      return { kind: 'internal-error' };
    case 'timeout':
      return { kind: 'timeout' };
    case 'unreachable':
      return { kind: 'upstream-unavailable', transportReason: reason(result.errorMessage) };
    case 'http-error':
      return http(result);
    case 'ok': {
      const decoded = contract(await json(result.response), result.status);
      return decoded.kind === 'ok'
        ? { kind: 'payload', status: result.status, value: decoded.value }
        : decoded;
    }
  }
}

function indexPath(locale: CmsLocale, cursor: string | undefined): string {
  const query = new URLSearchParams({ locale, limit: String(INDEX_PAGE_LIMIT) });
  if (cursor !== undefined) query.set('cursor', cursor);
  return `/api/v0/entries?${query.toString()}`;
}

function findPublicId(
  value: unknown,
  locale: CmsLocale,
  slug: string,
):
  | { kind: 'hit'; publicId: string; hasMore: boolean; cursor: string | null }
  | { kind: 'miss'; hasMore: boolean; cursor: string | null }
  | { kind: 'invalid' } {
  if (typeof value !== 'object' || value === null) return { kind: 'invalid' };
  const data: unknown = Reflect.get(value, 'data');
  const page: unknown = Reflect.get(value, 'page');
  if (!Array.isArray(data) || typeof page !== 'object' || page === null) return { kind: 'invalid' };
  const hasMore = Reflect.get(page, 'has_more') === true;
  const nextCursor: unknown = Reflect.get(page, 'next_cursor');
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== 'string') {
    return { kind: 'invalid' };
  }
  const cursor = typeof nextCursor === 'string' ? nextCursor : null;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) return { kind: 'invalid' };
    if (Reflect.get(item, 'slug') !== slug || Reflect.get(item, 'locale') !== locale) continue;
    const publicId: unknown = Reflect.get(item, 'public_id');
    if (typeof publicId !== 'string' || publicId.length === 0) return { kind: 'invalid' };
    return { kind: 'hit', publicId, hasMore, cursor };
  }
  return { kind: 'miss', hasMore, cursor };
}

export interface CmsClient {
  fetchDocument(locale: CmsLocale, slug: string): Promise<CmsFetchResult>;
}

export function createCmsClient(rails: RailsClient): CmsClient {
  return {
    async fetchDocument(locale, slug) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
        return { kind: 'upstream-protocol-error', upstreamStatus: 400 };

      let cursor: string | undefined;
      let publicId: string | undefined;
      for (let page = 0; page < MAX_INDEX_PAGES; page += 1) {
        const listed = await mapTransport(
          await rails.fetch(indexPath(locale, cursor), {
            headers: { Accept: 'application/json' },
          }),
        );
        if (listed.kind !== 'payload') return listed;
        const found = findPublicId(listed.value, locale, slug);
        if (found.kind === 'invalid')
          return {
            kind: 'invalid-contract',
            reason: 'schema_mismatch',
            upstreamStatus: listed.status,
          };
        if (found.kind === 'hit') {
          publicId = found.publicId;
          break;
        }
        if (!found.hasMore || found.cursor === null)
          return { kind: 'not-found', upstreamStatus: 404 };
        cursor = found.cursor;
      }
      if (publicId === undefined) return { kind: 'not-found', upstreamStatus: 404 };

      const shown = await mapTransport(
        await rails.fetch(`/api/v0/entries/${encodeURIComponent(publicId)}?locale=${locale}`, {
          headers: { Accept: 'application/json' },
        }),
      );
      if (shown.kind !== 'payload') return shown;
      const parsed = parseCmsDocument(shown.value);
      if (parsed.kind !== 'ok')
        return {
          kind: 'invalid-contract',
          reason: parsed.reason,
          upstreamStatus: shown.status,
        };
      if (parsed.document.locale !== locale || parsed.document.slug !== slug)
        return {
          kind: 'invalid-contract',
          reason: 'schema_mismatch',
          upstreamStatus: shown.status,
        };
      return { kind: 'ok', document: parsed.document, upstreamStatus: shown.status };
    },
  };
}
