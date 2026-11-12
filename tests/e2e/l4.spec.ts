import { test, expect } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test('recent-client scout sale is at most 6 taps', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').waitFor();
  let taps = 0;
  const tap = async (target: ReturnType<typeof page.getByTestId>) => {
    await target.click();
    taps += 1;
  };
  await tap(page.getByTestId('product-scout'));
  await tap(page.getByTestId('config-flavor-mint-inc'));
  await tap(page.getByTestId('config-add'));
  const review = page.getByRole('dialog', { name: 'Review sale' });
  await tap(review.getByRole('button', { name: 'Test Client A' }).first());
  await tap(review.getByTestId('charge'));
  expect(taps).toBeLessThanOrEqual(6);
  await page.getByText(/Sale recorded/).first().waitFor({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'New sale' })).toBeVisible();
});

test('charge stays disabled until a customer is chosen', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const charge = page.locator('[data-desktop-cart]').getByTestId('charge');
  await expect(charge).toBeDisabled();
  await expect(page.locator('[data-desktop-cart]').getByTestId('charge-reason')).toHaveText(
    'Add a customer to continue',
  );
});

test('undo puts a removed line back', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const review = page.getByRole('dialog', { name: 'Review sale' });
  await review.getByRole('button', { name: /Remove Plain/i }).click();
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('dialog', { name: 'Review sale' }).getByText('Plain').first()).toBeVisible();
});

test('tile to config sheet is under 100ms in the page', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').waitFor();
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const ms = await page.evaluate(async () => {
    const tile = document.querySelector('[data-testid="product-scout"]');
    if (!(tile instanceof HTMLElement)) return 9999;
    const start = performance.now();
    tile.click();
    const deadline = start + 1000;
    while (performance.now() < deadline) {
      if (document.querySelector('[data-testid="config-add"]')) return performance.now() - start;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    return performance.now() - start;
  });
  expect(ms).toBeLessThanOrEqual(100);
});

test('config sheet shows on-hand stock', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').click();
  await expect(page.getByText(/in stock/).first()).toBeVisible();
});

test('a recent client with credit shows an owes hint', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const review = page.getByRole('dialog', { name: 'Review sale' });
  await expect(review.getByText(/owes UGX/).first()).toBeVisible();
});

test('the cart is still there after reload', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  await page.reload();
  await expect(page.locator('[data-desktop-cart]').getByText('Plain').first()).toBeVisible();
});

test('releasing a loaded store order clears it from the cart', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId('load-order-seed-pending-order').click();
  await page.waitForURL(/\/sell/);
  const cart = page.locator('[data-desktop-cart]');
  await cart.getByTestId('release-store-order').click();
  await expect(cart.getByTestId('confirm-store-order')).toHaveCount(0);
  await expect(cart.getByTestId('cancelled-banner')).toHaveCount(0);
});

test('a cancelled store order shows a banner in the cart', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId('load-order-seed-pending-order').click();
  await page.waitForURL(/\/sell/);
  await page.goto('/next/orders');
  await page.getByRole('tab', { name: 'In sale' }).click();
  await page.getByTestId('cancel-order-seed-pending-order').click();
  await page.getByRole('status').filter({ hasText: /cancelled/i }).waitFor();
  await page.goto('/next/sell');
  await expect(page.locator('[data-desktop-cart]').getByTestId('cancelled-banner')).toContainText(/cancelled/i);
});

test('stock glance, install steps, chart range, and debug capture are on the page', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_admin' });
  await page.goto('/next/stock');
  await expect(page.getByTestId('stock-glance')).toContainText(/out/);
  await page.goto('/next/settings');
  await expect(page.getByTestId('install-steps')).toContainText('Add to Home Screen');
  await page.goto('/next/insights');
  await expect(page.getByTestId('insights-today')).toBeVisible();
  await expect(page.getByTestId('insights-credit')).toBeVisible();
  await expect(page.getByTestId('insights-rank')).toBeVisible();
  await page.getByTestId('chart-range').getByRole('button', { name: '1M' }).click();
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('venus_chart_range'))).toBe('1m');
  await page.goto('/next/system');
  await page.getByTestId('debug-capture').click();
  await expect(page.getByTestId('debug-log')).toContainText('capture');
  await page.getByTestId('debug-copy').click();
  await expect(page.getByRole('status').filter({ hasText: /copied/i })).toBeVisible();
  await page.getByTestId('debug-recover').click();
  await expect(page.getByRole('status').filter({ hasText: /reloaded/i })).toBeVisible();
  await page.goto('/next/clients');
  await page.getByTestId('copy-client-names').click();
  await expect(page.getByRole('status').filter({ hasText: /copied/i })).toBeVisible();
});

test('legacy inventory URL and the store-orders hash land on the new screens', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_admin' });
  await page.goto('/next/pages/inventory.html');
  await expect(page.getByTestId('stock-glance')).toBeVisible();
  await page.goto('/next/sell#store-orders');
  await page.waitForURL(/\/orders/);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('signed-out sell does not paint the register', async ({ page }) => {
  await page.goto('/next/sell');
  await page.waitForURL(/auth\.html/);
  await expect(page.getByTestId('product-scout')).toHaveCount(0);
});

test('reduced motion collapses the duration tokens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').waitFor();
  const fast = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--d-fast').trim());
  expect(fast).toBe('1ms');
});
