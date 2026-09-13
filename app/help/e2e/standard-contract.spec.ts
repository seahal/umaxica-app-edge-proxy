import { expect, test } from '@playwright/test';

/*
 * Browser-only behaviour around the standard URL contract.
 *
 * The contract itself — which paths answer, with which status and which
 * Content-Type — moved to `api/standard-contract.hurl`. It never needed a
 * browser, and running it here meant starting Chromium to read nine status
 * lines. What is left is what only a browser can tell us: that the service
 * worker registers and activates, and that a real navigation falls back to the
 * offline document when the network is gone.
 */

test('links the manifest and registers the service worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  const scriptURL = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).active?.scriptURL,
  );
  expect(scriptURL).toContain('/service-worker.js');
});

test('falls back only when a navigation cannot reach the network', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  try {
    await page.goto('/network-is-unavailable');
    await expect(page.getByRole('heading', { name: 'オフラインです' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
