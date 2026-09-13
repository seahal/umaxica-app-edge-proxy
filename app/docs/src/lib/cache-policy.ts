/*
 * Every `Cache-Control` value this unit's HTML routes send, in one file.
 *
 * The explicit public cache scope is deliberately ONE route:
 * `/{lang}/entries/{public_id}/`, and only when it rendered an Entry. Home, the
 * entry collection, its pagination and search carry no cache strategy in this
 * phase (docs/caching-and-isr.md); the collection keeps the `no-store` it has
 * always sent, and every failure document is `no-store` so an outage is never
 * remembered.
 *
 * The cache key is the request URL, so it already separates what must never be
 * shared: the host (one cell per hostname), the locale (first path segment) and
 * the `public_id` (last path segment). Nothing here varies on a header.
 *
 * Change the TTL here and nowhere else.
 */
export const ENTRY_CACHE_TTL_SECONDS = 60;

export const ENTRY_CACHE_CONTROL = `public, max-age=${String(ENTRY_CACHE_TTL_SECONDS)}, s-maxage=${String(ENTRY_CACHE_TTL_SECONDS)}`;

export const NO_STORE = 'no-store';
