import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, LOCALES, UI, isLocale, negotiateLocale } from '../src/i18n';

describe('locales', () => {
  it('treats only ja and en as locales', () => {
    expect(LOCALES).toEqual(['ja', 'en']);
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('JA')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('carries the same UI keys in both languages, and translates them', () => {
    expect(Object.keys(UI.en).sort()).toEqual(Object.keys(UI.ja).sort());
    expect(UI.ja.home).toBe('ホーム');
    expect(UI.en.home).toBe('Home');
    for (const key of ['entries', 'search', 'previous', 'next', 'manage', 'edit'] as const) {
      expect(UI.ja[key]).not.toBe(UI.en[key]);
    }
    expect(UI.ja.entriesPageTitle(2)).toContain('2');
    expect(UI.en.searchResultCount(3, 'api')).toBe('3 results for “api”');
    expect(UI.ja.searchNoResults('x')).toContain('「x」');
  });
});

describe('locale negotiation at /', () => {
  it('falls back to the default locale when the header is missing or unmatched', () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale('fr-FR,de;q=0.8')).toBe(DEFAULT_LOCALE);
  });

  it('prefers the highest-q supported language', () => {
    expect(negotiateLocale('en-US,en;q=0.9,ja;q=0.8')).toBe('en');
    expect(negotiateLocale('ja-JP,en;q=0.4')).toBe('ja');
  });

  it('skips empty language tags', () => {
    expect(negotiateLocale(',en;q=0.9')).toBe('en');
  });
});
