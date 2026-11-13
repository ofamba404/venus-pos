import { test, expect } from '@playwright/test';
import { openCartScenario } from './helpers/open-cart';
import { createNextDriver } from './drivers/next';

// These run against a production build served under /next/ (the "dist" project), where the base path
// is real. The Vite dev server can hide routing bugs that only show up there.

test('Orders Review sale opens the Review sale sheet in place under the /next/ base path', async ({ page }) => {
  await openCartScenario(page);
});

test('routes keep the /next/ prefix and unknown deep links land on a real page', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_admin' });
  for (const path of ['/next/orders', '/next/clients', '/next/cookie-partner', '/next/insights', '/next/history']) {
    await page.goto(path);
    await expect(page.locator('main, .shell').first()).toBeVisible();
    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe(path);
  }
});
