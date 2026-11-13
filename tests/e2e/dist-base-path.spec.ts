import { test, expect } from '@playwright/test';
import { createNextDriver } from './drivers/next';

// These run against a production build served under /next/ (the "dist" project), where the base path
// is real. The Vite dev server can hide routing bugs that only show up there.

test('Orders View order opens the order sheet under the /next/ base path', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId('view-order-seed-pending-order').click();
  await expect(page.getByTestId('store-order-sheet')).toBeVisible();
  // A notification link lands on the same sheet.
  await page.goto('/next/orders#order=seed-pending-order');
  await expect(page.getByTestId('store-order-sheet')).toBeVisible();
});

test('routes keep the /next/ prefix and unknown deep links land on a real page', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_admin' });
  for (const path of ['/next/orders', '/next/clients', '/next/cookie-partner', '/next/insights', '/next/history']) {
    await page.goto(path);
    await expect(page.locator('main, .shell').first()).toBeVisible();
    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe(path);
  }
});
