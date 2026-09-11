/*
 * This unit's language machinery and every UI string it renders —
 * byte-identical across all twelve public content units.
 *
 * Two locales, both carried in the URL as a mandatory first segment (`/ja/…`,
 * `/en/…`). The URL locale is the ONLY locale source for a rendered page: it
 * drives `<html lang>`, these strings, the Rails `locale=` parameter, canonical
 * and hreflang, and every link the page emits. `Accept-Language` is read in one
 * place only — the bare `/`, which has no locale yet and redirects to one.
 *
 * A two-language dictionary does not need an i18n framework. It needs one typed
 * object per language, checked by the compiler for missing keys, and that is
 * all this is. Copy that varies by surface (docs / help / info / news) lives in
 * `src/lib/site-copy.ts`; this file holds what every surface shares.
 */

export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** The locale `x-default` points at and the locale-less documents speak. */
export const DEFAULT_LOCALE: Locale = 'ja';

export function isLocale(value: string | undefined): value is Locale {
  return value === 'ja' || value === 'en';
}

/**
 * Negotiate a locale from an `Accept-Language` header, for the bare `/` only. A
 * request that expresses no preference for either supported language falls back
 * to `DEFAULT_LOCALE`.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .toLowerCase()
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag, q: q === undefined ? 1 : Number(q) };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (!tag) continue;
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

export interface UiStrings {
  skipToMain: string;
  brand: string;
  primaryNavLabel: string;
  utilityNavLabel: string;
  home: string;
  entries: string;
  search: string;
  about: string;
  viewEntries: string;
  entriesTitle: string;
  entriesHeading: string;
  entriesDescription: string;
  entriesEmpty: string;
  entriesPageTitle: (page: number) => string;
  previous: string;
  next: string;
  pagination: string;
  manage: string;
  edit: string;
  publishedAt: string;
  entryBodyStructured: string;
  searchTitle: string;
  searchHeading: string;
  searchDescription: string;
  searchLabel: string;
  searchSubmit: string;
  searchPrompt: string;
  searchNoResults: (query: string) => string;
  searchResultCount: (count: number, query: string) => string;
  searchTemporaryNotice: string;
  unavailableTitle: string;
  unavailableHeading: string;
  unavailableBody: string;
}

export const UI: Record<Locale, UiStrings> = {
  ja: {
    skipToMain: '本文へスキップ',
    brand: 'UMAXICA',
    primaryNavLabel: 'メインナビゲーション',
    utilityNavLabel: 'ユーティリティナビゲーション',
    home: 'ホーム',
    entries: 'エントリー',
    search: '検索',
    about: 'このサイトについて',
    viewEntries: '公開エントリーを見る',
    entriesTitle: 'エントリー',
    entriesHeading: '公開エントリー',
    entriesDescription: '公開されているエントリーの一覧です。',
    entriesEmpty: '公開エントリーはまだありません。',
    entriesPageTitle: (page) => `エントリー（${String(page)} ページ目）`,
    previous: '前のページ',
    next: '次のページ',
    pagination: 'ページ送り',
    manage: '管理',
    edit: '編集',
    publishedAt: '公開日時',
    entryBodyStructured:
      '本文は構造化オブジェクトとして保持されています。公開レンダラーは body の固定スキーマを仮定しません。',
    searchTitle: '検索',
    searchHeading: 'エントリーを検索',
    searchDescription: 'このサイトの公開エントリーを検索します。',
    searchLabel: '検索キーワード',
    searchSubmit: '検索する',
    searchPrompt: 'キーワードを入力して検索してください。',
    searchNoResults: (query) => `「${query}」に一致するエントリーは見つかりませんでした。`,
    searchResultCount: (count, query) => `「${query}」の検索結果: ${String(count)} 件`,
    searchTemporaryNotice:
      '検索は現在、仮のサンプルデータで動作しています。結果は公開エントリーの一覧と一致しない場合があります。',
    unavailableTitle: 'このページを表示できません',
    unavailableHeading: 'このページを表示できません',
    unavailableBody: '一時的にページを表示できません。時間をおいて再度お試しください。',
  },
  en: {
    skipToMain: 'Skip to main content',
    brand: 'UMAXICA',
    primaryNavLabel: 'Main navigation',
    utilityNavLabel: 'Utility navigation',
    home: 'Home',
    entries: 'Entries',
    search: 'Search',
    about: 'About this site',
    viewEntries: 'View published entries',
    entriesTitle: 'Entries',
    entriesHeading: 'Published entries',
    entriesDescription: 'A list of published entries.',
    entriesEmpty: 'No published entries yet.',
    entriesPageTitle: (page) => `Entries (page ${String(page)})`,
    previous: 'Previous',
    next: 'Next',
    pagination: 'Pagination',
    manage: 'Manage',
    edit: 'Edit',
    publishedAt: 'Published',
    entryBodyStructured:
      'The body is a structured object. The public renderer does not assume a frozen body schema.',
    searchTitle: 'Search',
    searchHeading: 'Search entries',
    searchDescription: 'Search the published entries on this site.',
    searchLabel: 'Search terms',
    searchSubmit: 'Search',
    searchPrompt: 'Enter a keyword to search.',
    searchNoResults: (query) => `No entries matched “${query}”.`,
    searchResultCount: (count, query) => `${String(count)} results for “${query}”`,
    searchTemporaryNotice:
      'Search currently runs on temporary sample data. Results may not match the published entry list.',
    unavailableTitle: 'Unable to display this page',
    unavailableHeading: 'Unable to display this page',
    unavailableBody: 'This page cannot be shown right now. Please try again later.',
  },
};
