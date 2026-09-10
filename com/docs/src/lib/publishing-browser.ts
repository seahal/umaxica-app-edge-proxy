export type PublishedLocale = 'ja' | 'en';

export interface PublishedEntryCard {
  public_id: string;
  title: string;
  summary: string | null;
}

export interface PublishedEntriesPage {
  data: PublishedEntryCard[];
  page: { next_cursor: string | null; has_more: boolean };
}

export function publishedEntriesUrl(locale: PublishedLocale, cursor?: string): string {
  const query = new URLSearchParams({ locale });
  if (cursor !== undefined) query.set('cursor', cursor);
  return `/api/v0/entries?${query.toString()}`;
}

export function publishedEntryHref(locale: PublishedLocale, publicId: string): string {
  return `/${locale}/entries/${encodeURIComponent(publicId)}/`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function parsePublishedEntriesPage(value: unknown): PublishedEntriesPage | null {
  if (typeof value !== 'object' || value === null) return null;
  const data = Reflect.get(value, 'data');
  const page = Reflect.get(value, 'page');
  if (!Array.isArray(data) || typeof page !== 'object' || page === null) return null;
  const cards: PublishedEntryCard[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) return null;
    const publicId = readString(Reflect.get(item, 'public_id'));
    const title = readString(Reflect.get(item, 'title'));
    if (publicId === null || title === null) return null;
    const summaryRaw = Reflect.get(item, 'summary');
    const summary = summaryRaw === null ? null : readString(summaryRaw);
    if (summaryRaw !== null && summary === null) return null;
    cards.push({ public_id: publicId, title, summary });
  }
  const next = Reflect.get(page, 'next_cursor');
  const hasMore = Reflect.get(page, 'has_more');
  if (!(next === null || typeof next === 'string') || typeof hasMore !== 'boolean') return null;
  return { data: cards, page: { next_cursor: next, has_more: hasMore } };
}
