import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.CONTRAST_SHOT_DIR || '/workspace/shots3';

test('capture the contrast pass at 390px', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/next/auth.html');
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/contrast-login.png`, fullPage: true });

  const driver = await createNextDriver(page, { role: 'pos_admin' });
  driver.mock.db.table('store_orders').push({
    id: 'ct-delivery',
    status: 'confirmed',
    customer_name: 'Bartholomew Nakimuli Wolfeschlegelstein',
    phone_e164: '+256700333444',
    created_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    dismissed_at: null,
    sale_id: null,
    items: [
      { product_id: 'variety', product_name: 'Variety Pack', line_total: 50000, breakdown: { mint: 1, strawberry: 1, blueberry: 1, watermelon: 1, grape: 1, coconut: 1, melon: 1, classic: 1 } },
      { product_id: 'pilot', product_name: 'Pilot Pack', line_total: 15000, breakdown: { mint: 1, grape: 1 } },
    ],
    delivery_enabled: true,
    delivery: { mode: 'scheduled', label: 'Tomorrow, 5:30 PM', deliverAt: '2026-11-13T14:30:00.000Z' },
    location_label: 'Plot 14 Acacia Avenue, Kololo, Kampala',
    location_lat: 0.33,
    location_lng: 32.59,
    delivery_fee_ugx: 7000,
  });
  const hideNav = () => page.addStyleTag({ content: '.shell__nav{display:none!important}' });

  await page.goto('/next/sell');
  await page.getByTestId('product-scout').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${dir}/contrast-sell-pink-tiles.png` });

  await page.goto('/next/insights');
  await page.locator('h1').first().waitFor();
  await page.waitForTimeout(700);
  await hideNav();
  await page.screenshot({ path: `${dir}/contrast-insights-kpi-tiles.png`, fullPage: true });

  await page.goto('/next/orders');
  await page.getByTestId('load-order-ct-delivery').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await hideNav();
  await page.locator('article.v-order-card').first().screenshot({ path: `${dir}/contrast-order-card.png` });

  await page.getByTestId('load-order-ct-delivery').click();
  await page.waitForURL(/\/sell/);
  await page.getByTestId('loaded-order').waitFor();
  await page.waitForTimeout(4500);
  await hideNav();
  await page.screenshot({ path: `${dir}/contrast-loaded-order-card.png` });

  await page.getByTestId('cart-bar').click();
  const review = page.getByRole('dialog', { name: 'Review sale' });
  await review.waitFor();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${dir}/contrast-checkout-header-and-lines.png` });
  await review.getByTestId('copy-all').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/contrast-checkout-delivery-block-and-total.png` });
});
