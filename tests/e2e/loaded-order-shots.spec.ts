import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.LOADED_SHOT_DIR || '/workspace/shots3';
const tag = process.env.LOADED_SHOT_TAG || 'before';

test('capture the loaded-order screens at 390px', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_admin' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const orders = driver.mock.db.table('store_orders');
  orders.push(
    {
      id: 'shot-delivery',
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
          detail: 'Mint, Strawberry, Blueberry, Watermelon, Grape, Coconut, Melon + Plain',
          line_total: 40000,
          breakdown: { mint: 1, strawberry: 1, blueberry: 1, watermelon: 1, grape: 1, coconut: 1, melon: 1, classic: 1 },
        },
        {
          product_id: 'pilot',
          product_name: 'Pilot Pack',
          detail: 'Mint, Grape',
          line_total: 15000,
          breakdown: { mint: 1, grape: 1 },
        },
        {
          product_id: 'cookie_duet',
          product_name: 'Cookie Duet',
          detail: 'Butterscotch, Chocolate',
          line_total: 15000,
          breakdown: { butterscotch: 1, chocolate: 1 },
        },
      ],
      delivery_enabled: true,
      delivery: { mode: 'scheduled', label: 'Tomorrow, 5:30 PM', deliverAt: '2026-11-13T14:30:00.000Z' },
      location_label: 'Plot 14 Acacia Avenue, Kololo, Kampala',
      location_lat: 0.33,
      location_lng: 32.59,
      delivery_fee_ugx: 7000,
      delivery_distance_km: 4.2,
      delivery_duration_min: 16,
    },
    {
      id: 'shot-pickup',
      status: 'confirmed',
      customer_name: 'Pickup Customer Nabukeera',
      phone_e164: '+256700555666',
      created_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      dismissed_at: null,
      sale_id: null,
      items: [
        { product_id: 'pilot', product_name: 'Pilot Pack', detail: 'Mint, Grape', line_total: 15000, breakdown: { mint: 1, grape: 1 } },
      ],
      delivery_enabled: false,
      location_label: null,
      location_lat: null,
      location_lng: null,
      delivery_fee_ugx: null,
    },
  );

  async function frame() {
    await page.addStyleTag({ content: '.shell__nav{display:none!important}' });
  }
  async function load(id: string) {
    await page.goto('/next/orders');
    await page.getByTestId(`load-order-${id}`).waitFor({ timeout: 20_000 });
    await page.getByTestId(`load-order-${id}`).click();
    await page.waitForURL(/\/sell/);
    await page.getByTestId('cart-bar').waitFor();
    await page.waitForTimeout(500);
    await frame();
  }

  await page.goto('/next/orders');
  await page.getByTestId('load-order-shot-delivery').waitFor({ timeout: 20_000 });
  await frame();
  await page.screenshot({ path: `${dir}/loaded-order-${tag}-1-orders-card.png`, fullPage: true });

  await load('shot-delivery');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${dir}/loaded-order-${tag}-2-sell-after-load.png` });
  await page.screenshot({ path: `${dir}/loaded-order-${tag}-2b-sell-after-load-full.png`, fullPage: true });

  await page.getByTestId('cart-bar').click();
  const review = page.getByRole('dialog', { name: 'Review sale' });
  await review.waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/loaded-order-${tag}-3-review-top.png` });
  await review.getByTestId('copy-phone').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/loaded-order-${tag}-4-review-delivery-copy.png` });
  await review.getByTestId('release-store-order').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/loaded-order-${tag}-5-review-order-actions.png` });
  await page.keyboard.press('Escape');

  await load('shot-pickup');
  await page.getByTestId('cart-bar').click();
  await page.getByRole('dialog', { name: 'Review sale' }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/loaded-order-${tag}-6-pickup-review.png` });
});
