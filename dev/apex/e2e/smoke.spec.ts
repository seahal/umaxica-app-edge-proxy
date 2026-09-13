import { expect, test } from '@playwright/test';

/*
 * That these routes answer 200 is asserted in `api/`. What is checked here is
 * the thing a status line cannot show: that the served HTML parses, renders,
 * and exposes its heading to the accessibility tree under a real engine.
 */

test('renders the local about page', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'About this site.' })).toBeVisible();
});

/*
 * The homepage renders in place. A browser follows redirects silently, so the
 * status assertion in `api/routes.hurl` is what proves `/` does not forward —
 * what this adds is that the final URL is still `/`, which is the part a user
 * would notice if the old `301 -> /about` came back.
 */
test('renders the homepage at the root without forwarding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'umaxica.dev' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});

/*
 * The stylesheet has to actually apply. Its URL differs between `vite dev` and
 * a build, and in dev Vite serves CSS as a JavaScript module unless asked for
 * it directly — a mistake that leaves the document unstyled while every status
 * code stays 200, so no HTTP-level assertion can catch it.
 */
test('applies the compiled stylesheet', async ({ page }) => {
  await page.goto('/');
  const bodyColor = await page
    .locator('body')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bodyColor).not.toBe('rgba(0, 0, 0, 0)');
});
