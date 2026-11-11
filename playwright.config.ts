import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.POS_BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'en-UG',
    timezoneId: 'Africa/Kampala',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone13', use: { ...devices['iPhone 13'] } },
  ],
});
