import { describe, expect, it } from 'vitest';

import { LOCALES } from '../../src/i18n';
import { PUBLISHING_AUDIENCE, PUBLISHING_SURFACE } from '../../src/lib/publishing-cell';
import { PUBLISHING_AUDIENCES, PUBLISHING_SURFACES } from '../../src/lib/publishing-model';
import { getSearchSource } from '../../src/lib/search/current-source';
import { createFixtureSearchSource } from '../../src/lib/search/fixture-search-source';
import { SEARCH_FIXTURES } from '../../src/lib/search/search-fixtures';
import { SEARCH_QUERY_MAX_LENGTH, normalizeSearchQuery } from '../../src/lib/search/search-source';

const thisCell = { surface: PUBLISHING_SURFACE, audience: PUBLISHING_AUDIENCE };

describe('temporary search fixtures', () => {
  it('cover all twelve cells in both locales, and are recognisably not Entries', () => {
    for (const surface of PUBLISHING_SURFACES) {
      for (const audience of PUBLISHING_AUDIENCES) {
        for (const locale of LOCALES) {
          const cell = SEARCH_FIXTURES.filter(
            (fixture) =>
              fixture.surface === surface &&
              fixture.audience === audience &&
              fixture.locale === locale,
          );
          expect(cell.length, `${surface}/${audience}/${locale}`).toBeGreaterThanOrEqual(2);
          for (const fixture of cell) {
            expect(fixture.publicId).toMatch(
              new RegExp(`^fixture-${surface}-${audience}-${locale}-`, 'u'),
            );
          }
        }
      }
    }
    expect(new Set(SEARCH_FIXTURES.map((fixture) => fixture.publicId)).size).toBe(
      SEARCH_FIXTURES.length,
    );
  });
});

describe('the search source this unit uses', () => {
  const source = getSearchSource();
  const mine = (locale: 'ja' | 'en') =>
    SEARCH_FIXTURES.filter(
      (fixture) =>
        fixture.surface === PUBLISHING_SURFACE &&
        fixture.audience === PUBLISHING_AUDIENCE &&
        fixture.locale === locale,
    );

  it.each(LOCALES)('finds this cell’s own %s fixtures, and only them', async (locale) => {
    const target = mine(locale)[0];
    expect(target).toBeDefined();
    const results = await source.search({ query: target?.title ?? '', locale, ...thisCell });

    expect(results.map((result) => result.publicId)).toContain(target?.publicId);
    for (const result of results) {
      expect(
        result.publicId.startsWith(
          `fixture-${PUBLISHING_SURFACE}-${PUBLISHING_AUDIENCE}-${locale}-`,
        ),
      ).toBe(true);
    }
  });

  it('never crosses surface, audience or locale', async () => {
    const other = SEARCH_FIXTURES.find(
      (fixture) =>
        fixture.surface !== PUBLISHING_SURFACE && fixture.audience === PUBLISHING_AUDIENCE,
    );
    expect(other).toBeDefined();
    await expect(
      source.search({
        query: other?.searchableText.split(' ')[0] ?? '',
        locale: 'ja',
        ...thisCell,
      }),
    ).resolves.toSatisfy((results: { publicId: string }[]) =>
      results.every((result) => !result.publicId.startsWith(`fixture-${other?.surface}-`)),
    );

    const english = mine('en')[0];
    await expect(
      source.search({ query: english?.title ?? '', locale: 'ja', ...thisCell }),
    ).resolves.toEqual([]);
  });

  it('answers an empty or blank query with nothing, and a miss with nothing', async () => {
    await expect(source.search({ query: '', locale: 'ja', ...thisCell })).resolves.toEqual([]);
    await expect(source.search({ query: '   ', locale: 'ja', ...thisCell })).resolves.toEqual([]);
    await expect(
      source.search({ query: 'zzzz-no-such-term', locale: 'en', ...thisCell }),
    ).resolves.toEqual([]);
  });

  it('matches case-insensitively and returns display fields only', async () => {
    const target = mine('en')[0];
    const results = await source.search({
      query: (target?.title ?? '').toUpperCase(),
      locale: 'en',
      ...thisCell,
    });
    expect(results[0]).toEqual({
      publicId: target?.publicId,
      title: target?.title,
      summary: target?.summary,
    });
  });
});

describe('query normalization', () => {
  it('trims and bounds the query', () => {
    expect(normalizeSearchQuery('  api  ')).toBe('api');
    expect(normalizeSearchQuery('x'.repeat(500))).toHaveLength(SEARCH_QUERY_MAX_LENGTH);
  });

  it('is applied by the fixture source itself', async () => {
    const source = createFixtureSearchSource([
      {
        publicId: 'fixture-a',
        locale: 'ja',
        ...thisCell,
        title: 'Alpha',
        summary: 's',
        searchableText: 't',
      },
    ]);
    await expect(
      source.search({ query: '  alpha ', locale: 'ja', ...thisCell }),
    ).resolves.toHaveLength(1);
  });
});
