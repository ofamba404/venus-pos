import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.CONFIRM_SHOT_DIR || '/workspace/shots3';
const LONG = 'Bartholomew Nakimuli Wolfeschlegelstein';

for (const width of [360, 390]) {
  test(`capture Confirm at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width, height: 844 });
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const pending = driver.mock.db.table('store_orders').find((r) => r.id === 'seed-pending-order')!;
    pending.customer_name = LONG;
    pending.delivery_enabled = true;
    pending.location_label = 'Plot 14 Bukoto Street, Kamwokya, Kampala';
    pending.items = [
      { product_id: 'pilot', product_name: 'Pilot Pack', line_total: 15000, breakdown: { mint: 1, grape: 1 } },
      { product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { strawberry: 1 } },
    ];
    const hideNav = () => page.addStyleTag({ content: '.shell__nav{display:none!important}' });

    await page.goto('/next/orders');
    const card = page.locator('article.v-order-card', { hasText: 'Wolfeschlegelstein' });
    await card.waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    await hideNav();
    await card.screenshot({ path: `${dir}/confirm-orders-card-pending-${width}.png` });
    await page.screenshot({ path: `${dir}/confirm-orders-page-${width}.png` });

    await page.getByTestId('confirm-order-seed-pending-order').click();
    await page.getByTestId('confirmed-seed-pending-order').waitFor();
    await page.waitForTimeout(500);
    await card.screenshot({ path: `${dir}/confirm-orders-card-confirmed-${width}.png` });

    // A second pending order, loaded straight into Sell, shows Confirm on the loaded-order card.
    driver.mock.db.table('store_orders').push({ ...pending, id: 'pending-two', status: 'pending', confirmed_at: null, customer_name: 'Grace Namukasa' });
    await page.goto('/next/orders');
    await page.getByTestId('load-order-pending-two').click();
    await page.waitForURL(/\/sell/);
    await page.getByTestId('loaded-order').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await hideNav();
    await page.screenshot({ path: `${dir}/confirm-loaded-order-pending-${width}.png` });
    await page.getByTestId('loaded-order-confirm').click();
    await page.getByTestId('loaded-order-confirmed').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/confirm-loaded-order-confirmed-${width}.png` });
    await page.getByTestId('cart-bar').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await sheet.waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/confirm-checkout-sheet-${width}.png` });
  });
}
