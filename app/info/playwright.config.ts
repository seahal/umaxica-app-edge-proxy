import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5403', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm run dev',
    /*
     * Wait on `/health`, not `/`. `/` is a 302 to `/ja/` or `/en/`. A stale
     * Worker can also answer 500 on `/` while `/ja/` still works. `/health` is
     * the live text/plain probe (200, no Rails hop), which Playwright treats as
     * ready (2xx).
     */
    url: 'http://localhost:5403/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
  },
});
