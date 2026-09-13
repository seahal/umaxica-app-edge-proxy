import type { Locale } from '../i18n';
import { PUBLISHING_SURFACE } from './publishing-cell';
import type { PublishingSurface } from './publishing-model';

/*
 * The copy that varies by surface — the home hero, the about page, the manifest
 * names — for all four surfaces, byte-identical across the twelve units.
 *
 * It depends on the surface only, never on the audience: `app/docs`,
 * `com/docs` and `org/docs` have always carried the same words. Keeping all
 * four here rather than one per unit is what lets this file (and every route
 * that reads it) stay identical across the twelve; the unit picks its row
 * through `PUBLISHING_SURFACE`.
 */
export interface SiteCopy {
  /** The surface's product name, used as the home page title segment. */
  product: string;
  siteName: string;
  heading: string;
  description: string;
  paragraphs: readonly string[];
  aboutParagraphs: readonly string[];
}

const COPY: Record<PublishingSurface, Record<Locale, SiteCopy>> = {
  docs: {
    ja: {
      product: 'Docs',
      siteName: 'UMAXICA ドキュメント',
      heading: '使い方と技術情報をまとめています',
      description: 'Documentation for the UMAXICA platform.',
      paragraphs: [
        'サービスの設定手順、API リファレンス、運用上の注意点を掲載しています。目的の項目が見つからない場合はヘルプをご利用ください。',
      ],
      aboutParagraphs: [
        'このサイトでは、UMAXICA のサービスをご利用いただくための使い方と技術情報をご案内しています。設定手順、API リファレンス、運用上の注意点を掲載しています。',
        '掲載内容は予告なく変更される場合があります。目的の項目が見つからない場合は、ヘルプをご利用ください。',
      ],
    },
    en: {
      product: 'Docs',
      siteName: 'UMAXICA Documentation',
      heading: 'Guides and technical reference',
      description: 'Documentation for the UMAXICA platform.',
      paragraphs: [
        'Setup procedures, API reference, and operational notes are published here. If you cannot find what you are looking for, please use Help.',
      ],
      aboutParagraphs: [
        'This site provides the guides and technical reference for using UMAXICA services: setup procedures, API reference, and operational notes.',
        'The content may change without notice. If you cannot find what you are looking for, please use Help.',
      ],
    },
  },
  help: {
    ja: {
      product: 'Help',
      siteName: 'UMAXICA ヘルプ',
      heading: 'お困りごとの解決をお手伝いします',
      description: 'Help and support for the UMAXICA platform.',
      paragraphs: [
        'よくあるご質問と対処方法をまとめています。解決しない場合は、お問い合わせフォームから状況をお知らせください。',
      ],
      aboutParagraphs: [
        'このサイトでは、UMAXICA のサービスをご利用中にお困りごとが生じた際の解決をお手伝いしています。よくあるご質問と対処方法をまとめています。',
        '掲載内容で解決しない場合は、お問い合わせフォームから状況をお知らせください。',
      ],
    },
    en: {
      product: 'Help',
      siteName: 'UMAXICA Help',
      heading: 'Help with whatever you run into',
      description: 'Help and support for the UMAXICA platform.',
      paragraphs: [
        'Frequently asked questions and their solutions are collected here. If your problem is not solved, please tell us what is happening through the contact form.',
      ],
      aboutParagraphs: [
        'This site helps you resolve problems that come up while using UMAXICA services. It collects frequently asked questions and their solutions.',
        'If the content here does not solve your problem, please tell us what is happening through the contact form.',
      ],
    },
  },
  info: {
    ja: {
      product: 'Info',
      siteName: 'UMAXICA インフォメーション',
      heading: 'サービスに関するご案内',
      description: 'Information about the UMAXICA platform.',
      paragraphs: [
        '提供中のサービス内容、利用条件、各種お手続きについてご案内しています。内容は予告なく変更される場合があります。',
      ],
      aboutParagraphs: [
        'このサイトでは、UMAXICA のサービスに関するご案内を掲載しています。提供中のサービス内容、利用条件、各種お手続きについてご確認いただけます。',
        '掲載内容は予告なく変更される場合があります。',
      ],
    },
    en: {
      product: 'Info',
      siteName: 'UMAXICA Information',
      heading: 'Service information',
      description: 'Information about the UMAXICA platform.',
      paragraphs: [
        'This site covers the services UMAXICA currently offers, their conditions of use, and the procedures related to them. The content may change without notice.',
      ],
      aboutParagraphs: [
        'This site publishes information about the services UMAXICA offers. You can review the services currently offered, their conditions of use, and the procedures related to them.',
        'The content may change without notice.',
      ],
    },
  },
  news: {
    ja: {
      product: 'News',
      siteName: 'UMAXICA ニュース',
      heading: '最新のお知らせをお届けします',
      description: 'News and announcements from UMAXICA.',
      paragraphs: [
        '新機能のリリース、メンテナンスの予定、障害発生時のご報告などを掲載しています。重要なお知らせは順次このページに追加されます。',
      ],
      aboutParagraphs: [
        'このサイトでは、UMAXICA からの最新のお知らせをお届けしています。新機能のリリース、メンテナンスの予定、障害発生時のご報告などを掲載しています。',
        '重要なお知らせは順次このページに追加されます。',
      ],
    },
    en: {
      product: 'News',
      siteName: 'UMAXICA News',
      heading: 'The latest announcements',
      description: 'News and announcements from UMAXICA.',
      paragraphs: [
        'Feature releases, scheduled maintenance windows, and incident reports are published here. Important announcements are added to this page as they arise.',
      ],
      aboutParagraphs: [
        'This site delivers the latest announcements from UMAXICA — feature releases, scheduled maintenance windows, and incident reports.',
        'Important announcements are added to this page as they arise.',
      ],
    },
  },
};

export function siteCopy(locale: Locale): SiteCopy {
  return COPY[PUBLISHING_SURFACE][locale];
}
