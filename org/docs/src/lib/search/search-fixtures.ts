import type { Locale } from '../../i18n';
import {
  PUBLISHING_AUDIENCES,
  PUBLISHING_SURFACES,
  type PublishingSurface,
} from '../publishing-model';
import type { SearchFixture } from './fixture-search-source';

/*
 * TEMPORARY development fixtures for the search route — NOT Publishing content.
 *
 * Rails does not provide search data yet. These records exist only so the
 * search UI has something to find in every one of the twelve cells and both
 * locales. They are generated for all twelve cells so that this file stays
 * byte-identical across the units; the fixture source filters by cell.
 *
 * Every `publicId` starts with `fixture-`, so a result link is recognisably not
 * a real Entry: following one asks Rails for an Entry that does not exist, and
 * the detail route answers with its ordinary not-found document.
 *
 * Delete this file together with `fixture-search-source.ts` when search is
 * backed by Rails.
 */

interface Topic {
  key: string;
  copy: Record<Locale, { title: string; summary: string; searchableText: string }>;
}

const TOPICS: Record<PublishingSurface, readonly Topic[]> = {
  docs: [
    {
      key: 'getting-started',
      copy: {
        ja: {
          title: 'はじめてのセットアップ',
          summary: 'アカウントの準備から最初の設定までの手順です。',
          searchableText: 'セットアップ 設定 手順 はじめて 導入',
        },
        en: {
          title: 'Getting started',
          summary: 'From preparing an account to your first configuration.',
          searchableText: 'setup configuration getting started onboarding',
        },
      },
    },
    {
      key: 'api-authentication',
      copy: {
        ja: {
          title: 'API 認証の概要',
          summary: 'API を呼び出すための認証方式を説明します。',
          searchableText: 'API 認証 トークン リファレンス',
        },
        en: {
          title: 'API authentication overview',
          summary: 'How requests to the API are authenticated.',
          searchableText: 'api authentication token reference',
        },
      },
    },
  ],
  help: [
    {
      key: 'sign-in-trouble',
      copy: {
        ja: {
          title: 'サインインできない場合',
          summary: 'サインインに失敗するときの確認事項です。',
          searchableText: 'サインイン ログイン パスワード できない',
        },
        en: {
          title: 'Trouble signing in',
          summary: 'What to check when signing in fails.',
          searchableText: 'sign in login password trouble',
        },
      },
    },
    {
      key: 'contact-support',
      copy: {
        ja: {
          title: 'お問い合わせの方法',
          summary: 'サポート窓口への連絡方法をご案内します。',
          searchableText: 'お問い合わせ サポート 連絡 フォーム',
        },
        en: {
          title: 'Contacting support',
          summary: 'How to reach the support team.',
          searchableText: 'contact support form help',
        },
      },
    },
  ],
  info: [
    {
      key: 'service-overview',
      copy: {
        ja: {
          title: 'サービスの概要',
          summary: '提供中のサービス内容をご案内します。',
          searchableText: 'サービス 概要 案内 提供',
        },
        en: {
          title: 'Service overview',
          summary: 'An overview of the services currently offered.',
          searchableText: 'service overview information offering',
        },
      },
    },
    {
      key: 'terms-of-use',
      copy: {
        ja: {
          title: '利用条件について',
          summary: 'サービスをご利用いただく際の条件です。',
          searchableText: '利用条件 規約 条件 手続き',
        },
        en: {
          title: 'Conditions of use',
          summary: 'The conditions that apply when using the services.',
          searchableText: 'conditions terms of use procedures',
        },
      },
    },
  ],
  news: [
    {
      key: 'maintenance-notice',
      copy: {
        ja: {
          title: '定期メンテナンスのお知らせ',
          summary: 'メンテナンスの予定日時と影響範囲です。',
          searchableText: 'メンテナンス 予定 お知らせ 停止',
        },
        en: {
          title: 'Scheduled maintenance notice',
          summary: 'When the maintenance happens and what it affects.',
          searchableText: 'maintenance schedule notice downtime',
        },
      },
    },
    {
      key: 'feature-release',
      copy: {
        ja: {
          title: '新機能リリースのお知らせ',
          summary: '新しく利用できるようになった機能のご紹介です。',
          searchableText: 'リリース 新機能 お知らせ アップデート',
        },
        en: {
          title: 'New feature release',
          summary: 'An introduction to the features now available.',
          searchableText: 'release new feature announcement update',
        },
      },
    },
  ],
};

export const SEARCH_FIXTURES: readonly SearchFixture[] = PUBLISHING_SURFACES.flatMap((surface) =>
  PUBLISHING_AUDIENCES.flatMap((audience) =>
    TOPICS[surface].flatMap((topic) =>
      (['ja', 'en'] as const).map((locale) => ({
        publicId: `fixture-${surface}-${audience}-${locale}-${topic.key}`,
        locale,
        surface,
        audience,
        ...topic.copy[locale],
      })),
    ),
  ),
);
