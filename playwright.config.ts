import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.POS_BASE_URL || 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL,
    locale: 'en-UG',
    timezoneId: 'Africa/Kampala',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  webServer: process.env.POS_BASE_URL
    ? undefined
    : {
        command: 'npx vite --host 127.0.0.1 --port 5173',
        url: 'http://127.0.0.1:5173/next/',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
