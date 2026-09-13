import { expect, test } from '@playwright/test';

/*
 * The user's path through a real browser: the shell, its landmarks, keyboard
 * access and the search form. Status codes and Content-Type belong in
 * `api/*.hurl`; the service worker stays in `e2e/standard-contract.spec.ts`.
 *
 * Cell-agnostic on purpose, so this file is byte-identical across the twelve
 * public content units: it asserts the structure every cell shares, never a
 * cell's own copy.
 */

test('home renders inside the shell, with locale-preserving navigation', async ({ page }) => {
  await page.goto('/ja/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
  await expect(nav.getByRole('link', { name: 'ホーム' })).toHaveAttribute('href', '/ja/');
  await expect(nav.getByRole('link', { name: 'エントリー' })).toHaveAttribute(
    'href',
    '/ja/entries/',
  );
  await expect(nav.getByRole('link', { name: '検索' })).toHaveAttribute('href', '/ja/search/');
  await expect(nav.getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('banner').getByRole('link', { name: 'UMAXICA' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'ユーティリティナビゲーション' }),
  ).toBeVisible();
});

test('english home keeps english navigation', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/en/search/');
});

test('the skip link moves focus to the main content', async ({ page }) => {
  await page.goto('/en/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();
});

test('search submits from the keyboard and lists results in the same locale', async ({ page }) => {
  await page.goto('/en/search/');
  const box = page.getByRole('searchbox', { name: 'Search terms' });
  await box.fill('e');
  await box.press('Enter');

  await expect(page).toHaveURL(/\/en\/search\/\?q=e$/u);
  await expect(page.getByRole('searchbox', { name: 'Search terms' })).toHaveValue('e');
  const results = page.getByRole('main').getByRole('listitem').getByRole('link');
  await expect(results.first()).toBeVisible();
  for (const href of await results.evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')),
  )) {
    expect(href).toMatch(/^\/en\/entries\/fixture-/u);
  }
});

test('a search with no match says so', async ({ page }) => {
  await page.goto('/ja/search/?q=zzzz-no-such-term');
  await expect(
    page.getByText('「zzzz-no-such-term」に一致するエントリーは見つかりませんでした。'),
  ).toBeVisible();
});

test('the entry collection renders a readable document when Rails is unavailable', async ({
  page,
}) => {
  await page.goto('/ja/entries/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'このページを表示できません' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'ホーム' }).last()).toHaveAttribute('href', '/ja/');
});

test('an unmatched path shows the 404 document', async ({ page }) => {
  await page.goto('/__not-a-page');
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'トップへ戻る' })).toBeVisible();
});
