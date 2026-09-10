import { describe, expect, it } from 'vitest';

import {
  parsePublishedEntriesPage,
  publishedEntriesUrl,
  publishedEntryHref,
} from '../../src/lib/publishing-browser';

describe('publishing browser contract', () => {
  it('builds same-origin URLs keyed by public_id and locale', () => {
    expect(publishedEntriesUrl('ja')).toBe('/api/v0/entries?locale=ja');
    expect(publishedEntriesUrl('en', 'next/1')).toBe('/api/v0/entries?locale=en&cursor=next%2F1');
    expect(publishedEntryHref('ja', '01ABC')).toBe('/ja/entries/01ABC/');
    expect(publishedEntriesUrl('ja')).not.toContain('localhost');
    expect(publishedEntriesUrl('ja')).not.toContain('http://');
  });

  it('parses a valid list and rejects a broken body', () => {
    expect(
      parsePublishedEntriesPage({
        data: [{ public_id: '01ABC', title: 'Hello', summary: null }],
        page: { next_cursor: null, has_more: false },
      }),
    ).toEqual({
      data: [{ public_id: '01ABC', title: 'Hello', summary: null }],
      page: { next_cursor: null, has_more: false },
    });
    expect(parsePublishedEntriesPage({ data: [{ title: 'x' }], page: { has_more: false } })).toBeNull();
  });
});
