import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5305',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm run dev',
    /*
     * `/health` is the live text/plain probe and answers 200 once the Worker
     * can serve. It no longer depends on Rails, so it is a valid Playwright
     * readiness URL (2xx). `/` still works, but a 500 on `/` would look like
     * "server not up" while the process is running.
     */
    url: 'http://localhost:5305/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
  },
});
