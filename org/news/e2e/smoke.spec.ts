import { expect, test } from '@playwright/test';

/*
 * HTML documents under Chromium. Status codes and Content-Type belong in
 * `api/*.hurl`. Service-worker behaviour stays in `e2e/standard-contract.spec.ts`
 * and is optional for a human walkthrough.
 */

const JA_HOME = '最新のお知らせをお届けします';
const EN_HOME = 'The latest announcements';

test('home ja renders inside the shell', async ({ page }) => {
  await page.goto('/ja/');
  await expect(page.getByRole('heading', { name: JA_HOME })).toBeVisible();
  await expect(page.getByRole('link', { name: '公開エントリーを見る' })).toHaveAttribute(
    'href',
    '/ja/entries/',
  );
  await expect(page.getByRole('banner').getByRole('link', { name: 'UMAXICA' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'ユーティリティナビゲーション' }),
  ).toBeVisible();
});

test('home en renders', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.getByRole('heading', { name: EN_HOME })).toBeVisible();
});

test('about ja and en render', async ({ page }) => {
  await page.goto('/ja/about/');
  await expect(page.getByRole('heading', { name: 'このサイトについて' })).toBeVisible();
  await page.goto('/en/about/');
  await expect(page.getByRole('heading', { name: 'About this site' })).toBeVisible();
});

test('unmatched path shows the 404 document', async ({ page }) => {
  await page.goto('/__not-a-page');
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'トップへ戻る' })).toBeVisible();
});

test('server-error document points at the status page, not reload', async ({ page }) => {
  await page.goto('/500');
  await expect(page.getByRole('heading', { name: 'サーバーエラーです' })).toBeVisible();
  await expect(page.getByRole('link', { name: '稼働状況を見る' })).toHaveAttribute(
    'href',
    'https://status.umaxica.dev/',
  );
  await expect(page.getByRole('button', { name: '再読み込み' })).toHaveCount(0);
});
