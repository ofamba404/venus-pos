import { test, expect } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test.describe('loaded store order', () => {
  test('Sell says it is a store order, and the cart sheet repeats it with the lines readable', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.setViewportSize({ width: 390, height: 844 });
    driver.mock.db.table('store_orders').push({
      id: 'lo-delivery',
      status: 'confirmed',
      customer_name: 'Bartholomew Nakimuli Wolfeschlegelstein',
      phone_e164: '+256700333444',
      created_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      dismissed_at: null,
      sale_id: null,
      items: [
        {
          product_id: 'variety',
          product_name: 'Variety Pack',
          line_total: 40000,
          breakdown: { mint: 1, strawberry: 1, blueberry: 1, watermelon: 1, grape: 1, coconut: 1, melon: 1, classic: 1 },
        },
      ],
      delivery_enabled: true,
      delivery: { mode: 'scheduled', label: 'Tomorrow, 5:30 PM', deliverAt: '2026-11-13T14:30:00.000Z' },
      location_label: 'Plot 14 Acacia Avenue, Kololo, Kampala',
      location_lat: 0.33,
      location_lng: 32.59,
      delivery_fee_ugx: 7000,
    });
    await page.goto('/next/orders');
    await page.getByTestId('load-order-lo-delivery').click();
    await page.waitForURL(/\/sell/);

    const banner = page.getByTestId('loaded-order');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-mode', 'delivery');
    await expect(banner.getByTestId('loaded-order-name')).toContainText('Wolfeschlegelstein');
    await expect(banner.getByTestId('loaded-order-place')).toContainText('Acacia Avenue');
    await expect(banner).toContainText('Tomorrow, 5:30 PM');
    await expect(banner.getByTestId('loaded-order-copy-phone')).toBeVisible();
    await expect(banner.getByTestId('loaded-order-copy-location')).toBeVisible();

    await banner.getByTestId('loaded-order-review').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await expect(sheet.getByTestId('loaded-order-cart')).toBeVisible();
    // The name wraps instead of truncating, and every swatch of the 8-flavour pack is on screen.
    const title = sheet.locator('.v-cart-line .v-list-row__title').first();
    expect(await title.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('normal');
    const strip = sheet.locator('.v-cart-line .v-swatches').first();
    expect(await strip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // No recent-client chips on a store order.
    await expect(sheet.getByTestId('walk-in')).toHaveCount(0);
  });

  test('a pickup order shows no location, and Detach order drops the banner but keeps the items', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/next/orders');
    await page.getByTestId('load-order-seed-pending-order').click();
    await page.waitForURL(/\/sell/);
    const banner = page.getByTestId('loaded-order');
    await expect(banner).toHaveAttribute('data-mode', 'pickup');
    await expect(banner.getByTestId('loaded-order-place')).toHaveCount(0);
    await expect(banner.getByTestId('loaded-order-unlink')).toHaveText('Detach order');
    await expect(banner.getByTestId('loaded-order-detach-hint')).toContainText('stays in Orders');
    await expect(banner.getByTestId('loaded-order-detach-hint')).toContainText('not cancelled');
    await banner.getByTestId('loaded-order-unlink').click();
    await expect(page.getByTestId('loaded-order')).toHaveCount(0);
    await expect(page.getByTestId('cart-bar')).toBeVisible();
    // The order is still in Orders (In sale, where loading put it), and nothing cancelled it.
    await page.goto('/next/orders');
    await page.getByRole('tab', { name: 'In sale' }).click();
    await expect(page.getByTestId('load-order-seed-pending-order')).toBeVisible();
    await expect(page.getByTestId('cancel-order-seed-pending-order')).toBeVisible();
  });
});
