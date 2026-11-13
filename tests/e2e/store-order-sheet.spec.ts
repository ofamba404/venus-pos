import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';
const iso = () => new Date().toISOString();

const DELIVERY = {
  id: 'so-delivery',
  status: 'accepted',
  customer_name: 'Muza Nakimuli',
  phone_e164: '+256700333444',
  created_at: iso(),
  confirmed_at: iso(),
  dismissed_at: null,
  sale_id: null,
  items: [
    { product_id: 'pilot', store_product_id: 'pilot-pack', product_name: 'Pilot Pack', detail: 'Mint ×2, Grape ×1', quantity: 1, line_total: 15000, breakdown: { mint: 2, grape: 1 } },
    { product_id: 'cookie_duet', product_name: 'Cookie Duet', detail: 'Mint, Chocolate', quantity: 1, line_total: 15000, breakdown: { cookie_mint: 1, cookie_chocolate: 1 } },
  ],
  delivery_enabled: true,
  delivery: { mode: 'scheduled', label: 'Tomorrow, 5:30 PM', deliverAt: '2026-11-14T14:30:00.000Z' },
  location_label: 'Plot 14 Acacia Avenue, Kololo, Kampala',
  location_lat: 0.33,
  location_lng: 32.59,
  delivery_fee_ugx: 7000,
  delivery_distance_km: 6.4,
  delivery_duration_min: 22,
};

test.describe('store order sheet', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Sell has no store-order or review card, and the cart is only for walk-in sales', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.db.table('store_orders').push(DELIVERY);
    await page.goto('/next/sell');
    await page.getByTestId('today-pill').waitFor();
    await expect(page.getByTestId('loaded-order')).toHaveCount(0);
    await expect(page.getByTestId('cart-bar')).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2j-sell-no-order-card.png` });

    await page.getByTestId('product-pilot').click();
    await page.getByTestId('config-flavor-mint-inc').click();
    await page.getByTestId('config-flavor-grape-inc').click();
    await page.getByTestId('config-add').click();
    const cart = page.getByRole('dialog', { name: 'Review sale' });
    await expect(cart).toBeVisible();
    await expect(cart.getByTestId('cart-client')).toBeVisible();
    await expect(cart.getByText('Store order')).toHaveCount(0);
    await expect(cart.getByTestId('release-store-order')).toHaveCount(0);
    await expect(cart.getByRole('button', { name: /Remove/ })).toHaveCount(1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2j-cart-walkin.png` });
  });

  test('an old cart link to a store order is dropped on load', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.addInitScript(() => {
      sessionStorage.setItem('venus-pos-order-meta', JSON.stringify({ storeOrderId: 'seed-pending-order', clientName: 'X' }));
    });
    await page.goto('/next/sell');
    await page.getByTestId('today-pill').waitFor();
    const meta = await page.evaluate(() => JSON.parse(sessionStorage.getItem('venus-pos-order-meta') || '{}'));
    expect(meta.storeOrderId || '').toBe('');
  });

  test('Orders: a tap on the card or View order opens a read-only sheet', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.db.table('store_orders').push(DELIVERY);
    await page.goto('/next/orders');
    await page.getByTestId('view-order-so-delivery').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2j-orders-waiting.png` });

    await page.getByTestId('order-card-so-delivery').locator('.order-card__headline').click();
    const sheet = page.getByTestId('store-order-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-mode', 'delivery');
    await expect(sheet.getByTestId('store-order-name')).toHaveText('Muza Nakimuli');
    // Read only: no steppers, no remove, no client or date/time inputs.
    await expect(sheet.getByRole('button', { name: /Remove|Edit/ })).toHaveCount(0);
    await expect(sheet.locator('input[type="date"], input[type="time"], input[type="datetime-local"]')).toHaveCount(0);
    await expect(sheet.locator('input')).toHaveCount(1); // the delivery fee, nothing else
    await expect(sheet.getByTestId('so-gallery').first()).toBeVisible();
    await expect(sheet.getByTestId('so-place-value')).toContainText('Acacia Avenue');
    await expect(sheet.getByTestId('so-phone-value')).toHaveText('+256700333444');
    await expect(sheet.getByTestId('so-when-value')).toHaveText('Tomorrow, 5:30 PM');
    await expect(sheet.getByTestId('so-distance-value')).toHaveText('6.4 km · ~22 min');
    await expect(sheet.getByTestId('store-order-confirmed')).toBeVisible();
    // Details are labelled read-only boxes. Copy is only on Drop-off and Phone, and it is as tall as its box.
    await expect(sheet.getByRole('button', { name: /Copy/ })).toHaveCount(2);
    await expect(sheet.getByTestId('so-copy-when')).toHaveCount(0);
    await expect(sheet.getByTestId('so-copy-all')).toHaveCount(0);
    for (const id of ['place', 'phone']) {
      const box = (await sheet.getByTestId(`so-${id}-value`).boundingBox())!;
      const btn = (await sheet.getByTestId(`so-copy-${id}`).boundingBox())!;
      expect(Math.abs(box.height - btn.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y - btn.y)).toBeLessThanOrEqual(1);
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2j-store-order-sheet-delivery-top.png` });
    await page.getByTestId('store-order-sheet').evaluate((el) => el.closest('.v-sheet__body')!.scrollTo({ top: 9999 }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/v2j-store-order-sheet-delivery-scrolled.png` });
  });

  test('the delivery fee updates the total, and Checkout records the sale from the order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.db.table('store_orders').push(DELIVERY);
    await page.goto('/next/orders');
    await page.getByTestId('view-order-so-delivery').click();
    const sheet = page.getByTestId('store-order-sheet');
    await expect(sheet.getByTestId('store-order-total')).toHaveAttribute('data-total', '37000');
    await sheet.getByTestId('store-order-fee').fill('9000');
    await expect(sheet.getByTestId('store-order-total')).toHaveAttribute('data-total', '39000');
    await expect(page.getByTestId('store-order-checkout')).toContainText('39,000');

    await page.getByTestId('store-order-checkout').click();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    await expect(page.getByTestId('success-total')).toHaveText(/30,000/);
    await expect(page.getByTestId('success-client')).toHaveText('Muza Nakimuli');
    await expect(page.getByText(/Sale recorded/)).toBeVisible();
    await expect(page.getByTestId('store-order-sheet')).toHaveCount(0);
    // The order is marked in the background; wait for it.
    await expect.poll(() => driver.mock.writes.some((w) => w.method === 'PATCH' && w.url.includes('store_orders'))).toBe(true);

    const sale = driver.mock.writes.find((w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'))!;
    const body = sale.body as { store_order_id: string; total_ugx: number; delivery_fee_ugx: number; is_credit: boolean; items: unknown[] };
    expect(body.store_order_id).toBe('so-delivery');
    expect(body.delivery_fee_ugx).toBe(9000);
    expect(body.total_ugx).toBe(30000);
    expect(body.is_credit).toBe(false);
    expect(body.items).toHaveLength(2);
    const patches = driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('store_orders'));
    const done = patches.find((w) => (w.body as { status?: string }).status === 'checked_out')!;
    expect(done.url).toContain('id=eq.so-delivery');
    expect((done.body as { sale_id?: string }).sale_id).toBeTruthy();
    expect(patches.some((w) => (w.body as { status?: string }).status === 'accepted')).toBe(false);
    const reserve = driver.mock.writes.filter((w) => w.url.includes('/api/store-order/reserve')).map((w) => (w.body as { op: string }).op);
    expect(reserve).toEqual(['consume']);

    // The order left Waiting for Closed. Done first: the success sheet sits over the page.
    await page.getByTestId('success-done').click();
    await expect(page.getByTestId('view-order-so-delivery')).toHaveCount(0);
    await page.getByRole('tab', { name: /Closed/ }).click();
    await expect(page.getByTestId('status-so-delivery')).toHaveText('Completed');
  });

  test('a pickup order shows no drop-off or fee, and Cancel order takes two taps', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/orders');
    await page.getByTestId('view-order-seed-pending-order').click();
    const sheet = page.getByTestId('store-order-sheet');
    await expect(sheet).toHaveAttribute('data-mode', 'pickup');
    await expect(sheet.getByTestId('so-place')).toHaveCount(0);
    await expect(sheet.getByTestId('store-order-fee')).toHaveCount(0);
    await expect(sheet.getByTestId('store-order-confirm')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2j-store-order-sheet-pickup.png` });

    await page.getByTestId('store-order-cancel').click();
    await expect(page.getByTestId('store-order-cancel')).toHaveText(/again/);
    expect(driver.mock.writes.filter((w) => w.url.includes('/api/store-order/reserve'))).toHaveLength(0);
    await page.getByTestId('store-order-cancel').click();
    await expect(page.getByText(/Cancelled/)).toBeVisible();
    await expect(page.getByTestId('store-order-sheet')).toHaveCount(0);
    const ops = driver.mock.writes.filter((w) => w.url.includes('/api/store-order/reserve')).map((w) => (w.body as { op: string }).op);
    expect(ops).toEqual(['release']);
  });

  test('a notification link (#order=id) opens the sheet on Orders', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/orders#order=seed-pending-order');
    await expect(page.getByTestId('store-order-sheet')).toBeVisible();
    await expect(page.getByTestId('store-order-name')).toBeVisible();
  });

  test('a closed order opens read only, with no Checkout or Cancel', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    const done = driver.mock.db.table('store_orders').find((r) => r.status === 'checked_out' || r.status === 'cancelled')!;
    await page.goto('/next/orders');
    await page.getByRole('tab', { name: /Closed/ }).click();
    await page.getByTestId(`order-card-${done.id}`).locator('.order-card__headline').click();
    await expect(page.getByTestId('store-order-sheet')).toBeVisible();
    await expect(page.getByTestId('store-order-checkout')).toHaveCount(0);
    await expect(page.getByTestId('store-order-cancel')).toHaveCount(0);
    await expect(page.getByTestId('store-order-fee')).toHaveCount(0);
  });
});
