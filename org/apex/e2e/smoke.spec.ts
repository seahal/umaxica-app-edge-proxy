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
