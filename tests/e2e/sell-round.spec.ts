import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test.describe('Sell page round', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Joints then Cookies, a store status circle, and Hours in a sheet', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/sell');
    const joints = page.locator('.v-section-label', { hasText: 'Joints' });
    const cookies = page.locator('.v-section-label', { hasText: 'Cookies' });
    await expect(joints).toBeVisible();
    await expect(cookies).toBeVisible();
    const jy = (await joints.boundingBox())!.y;
    const cy = (await cookies.boundingBox())!.y;
    expect(jy).toBeLessThan(cy);
    await expect(page.getByTestId('product-scout')).toBeVisible();
    await expect(page.getByTestId('product-cookie_duet')).toBeVisible();
    const status = page.getByTestId('store-status-btn');
    await expect(status).toHaveAttribute('data-state', /open|closed|busy/);
    await expect(status).toHaveText(/^(Open|Busy|Closed)$/i);
    const box = (await status.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    expect(box.width).toBeGreaterThanOrEqual(64);
    await status.click();
    await expect(page.getByRole('dialog', { name: 'Hours' })).toBeVisible();
    await expect(page.getByTestId('hours-open')).toBeVisible();
    await expect(page.getByTestId('busy-30')).toBeVisible();
    await expect(page.getByTestId('hours-suggest-start')).toHaveCount(0);
  });

  test('a confirmed store order shows a review bar that opens the sheet', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    const confirmed = driver.mock.db.table('store_orders').find((r) => r.status === 'confirmed' || r.status === 'accepted');
    expect(confirmed).toBeTruthy();
    await page.goto('/next/sell');
    const bar = page.getByTestId('review-bar');
    await expect(bar).toBeVisible();
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    await page.getByRole('dialog', { name: 'Cart' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog', { name: 'Cart' }).waitFor({ state: 'hidden' });
    const cart = page.getByTestId('cart-bar');
    await expect(cart).toBeVisible();
    const reviewBox = (await bar.boundingBox())!;
    const cartBox = (await cart.boundingBox())!;
    expect(Math.abs(reviewBox.height - cartBox.height)).toBeLessThan(2);
    expect(Math.abs(reviewBox.x - cartBox.x)).toBeLessThan(2);
    expect(reviewBox.y + reviewBox.height).toBeLessThan(cartBox.y);
    await bar.click();
    await expect(page.getByTestId('store-order-sheet')).toBeVisible();
  });

  test('Orders shows cached cards immediately, with no skeleton', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/orders');
    await expect(page.getByTestId('orders-loading')).toHaveCount(0);
    await expect(page.getByTestId('order-card-seed-pending-order')).toBeVisible();
  });
});
