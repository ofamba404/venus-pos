import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.POS_BASE_URL || 'http://127.0.0.1:5173';
const legacyPort = process.env.LEGACY_PORT || '4173';
const legacyOrigin = `http://127.0.0.1:${legacyPort}`;
/** A production build served under /next/, so base-path bugs the dev server hides show up. */
const distOrigin = 'http://127.0.0.1:4174';

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
    : [
        {
          command: 'npx vite --host 127.0.0.1 --port 5173',
          url: 'http://127.0.0.1:5173/next/',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          // Serves dist/. Run `npm run build` first: the dist project tests the production build under /next/.
          command: 'node scripts/preview-static.mjs',
          url: `${distOrigin}/next/`,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
        {
          command: 'node scripts/serve-legacy.mjs',
          url: `${legacyOrigin}/`,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /(legacy|dist-.*)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'dist',
      testMatch: /dist-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: distOrigin },
    },
    {
      name: 'legacy',
      testMatch: /legacy\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: legacyOrigin },
    },
  ],
});
