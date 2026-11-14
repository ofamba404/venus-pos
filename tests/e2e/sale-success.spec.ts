import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

async function sellOne(page: Page) {
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const sheet = page.getByRole('dialog', { name: 'Cart' });
  await sheet.getByTestId('cart-client').fill('Test Client A');
  await sheet.getByTestId('charge').click();
  await expect(page.getByTestId('sale-success')).toBeVisible();
}

test.describe('sale success sheet', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await createNextDriver(page, { role: 'pos_staff' });
  });

  test('shows the amount and client, and Done returns to where I was', async ({ page }) => {
    await sellOne(page);
    const dialog = page.getByRole('dialog', { name: 'Sale', exact: true });
    await expect(dialog.getByTestId('success-total')).toHaveText(/UGX 5,000/);
    await expect(dialog.getByTestId('success-client')).toHaveText('Test Client A');
    await expect(dialog.getByTestId('success-label')).toHaveText('Sale recorded');
    await expect(dialog.getByTestId('success-summary')).toBeVisible();
    await expect(dialog.getByTestId('success-line')).toHaveText(/1 × Plain/);
    await expect(dialog.getByTestId('success-fulfilment')).toHaveText('Walk-in');
    await expect(dialog.getByTestId('success-fee')).toHaveCount(0);
    await expect(dialog.getByText(/Delivery fee/)).toHaveCount(0);
    // The store's mark: an ink ring and check, not a green blob.
    const stroke = await dialog.locator('.v-ok__mark-ring').evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).toBe('rgb(33, 33, 33)');
    await expect(dialog.locator('.v-success__check')).toHaveCount(0);
    // Money is the app's bold sans, not Self Modern or Akkurat Mono.
    const font = await dialog.getByTestId('success-total').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toContain('geograph');
    expect(font.toLowerCase()).not.toContain('self modern');
    expect(font.toLowerCase()).not.toContain('akkurat');
    await expect(dialog.getByText('Amount', { exact: true })).toHaveCount(0);
    await dialog.getByTestId('success-done').click();
    await expect(page.getByTestId('sale-success')).toHaveCount(0);
    await expect(page).toHaveURL(/\/next\/sell/);
    await expect(page.getByTestId('cart-bar')).toHaveCount(0);
  });

  test('the close button, a scrim tap and Escape each dismiss it', async ({ page }) => {
    await sellOne(page);
    await expect(page.getByRole('dialog', { name: 'Cart' })).toHaveCount(0);
    await page.getByRole('dialog', { name: 'Sale', exact: true }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('sale-success')).toHaveCount(0);

    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Cart' });
    await sheet.getByTestId('cart-client').fill('Test Client A');
    await sheet.getByTestId('charge').click();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    await page.mouse.click(195, 60);
    await expect(page.getByTestId('sale-success')).toHaveCount(0);

    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    await sheet.getByTestId('cart-client').fill('Test Client A');
    await sheet.getByTestId('charge').click();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sale-success')).toHaveCount(0);
  });

  test('a swipe down dismisses it, a short drag springs back', async ({ page }) => {
    await sellOne(page);
    await page.waitForTimeout(900);
    const box = (await page.locator('.v-ok__panel').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 14;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    await page.waitForTimeout(300);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 160, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('sale-success')).toHaveCount(0);
    // Nothing is left over the page.
    await expect(page.locator('.v-ok')).toHaveCount(0);
    await page.getByTestId('product-plain_single').click();
    await expect(page.getByTestId('config-add')).toBeVisible();
  });

  const iso = () => new Date().toISOString();
  const MUZA = {
    id: 'so-muza',
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
  const BRYAN = {
    id: 'so-bryan',
    status: 'pending',
    customer_name: 'Bryan',
    phone_e164: '+256700332001',
    created_at: iso(),
    confirmed_at: null,
    dismissed_at: null,
    sale_id: null,
    items: [
      { product_id: 'plain_single', product_name: 'Plain', quantity: 2, line_total: 10000, breakdown: { classic: 2 } },
    ],
    delivery_enabled: false,
    delivery_fee_ugx: null,
  };

  function setOrders(driver: Awaited<ReturnType<typeof createNextDriver>>, rows: object[]) {
    const table = driver.mock.db.table('store_orders');
    table.splice(0, table.length, ...rows);
  }

  test('a sale with another order waiting shows the summary and prompts the next one', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    setOrders(driver, [{ ...MUZA }, { ...BRYAN }]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/next/orders');
    await page.getByTestId('view-order-so-muza').click();
    await expect(page.getByTestId('store-order-sheet')).toBeVisible();
    await page.getByTestId('store-order-checkout').click();
    const dialog = page.getByTestId('sale-success');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('success-client')).toHaveText('Muza Nakimuli');
    await expect(dialog.getByTestId('success-fulfilment')).toHaveText('Delivery');
    await expect(dialog.getByTestId('success-line')).toHaveCount(2);
    await expect(dialog.getByTestId('success-line').nth(0)).toHaveText(/1 × Pilot Pack/);
    await expect(dialog.getByTestId('success-line').nth(1)).toHaveText(/1 × Cookie Duet/);
    await expect(dialog.getByTestId('success-fee')).toHaveCount(0);
    await expect(dialog.getByText(/Delivery fee/)).toHaveCount(0);
    await expect(dialog.getByTestId('success-total')).toHaveText(/UGX 30,000/);
    await expect(dialog.getByTestId('success-another')).toHaveText('Next: Bryan · UGX 10,000');
    const font = await dialog.getByTestId('success-total').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toContain('geograph');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2o-success-next.png` });

    await dialog.getByTestId('success-another').click();
    await expect(page.getByTestId('sale-success')).toHaveCount(0);
    await expect(page).toHaveURL(/\/next\/orders/);
    const sheet = page.getByTestId('store-order-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('store-order-name')).toHaveText('Bryan');
    expect(driver.mock.writes.some((w) => w.url.includes('/rest/v1/sales'))).toBe(true);
  });

  test('with no waiting order, the secondary action is Log another sale', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    setOrders(driver, []);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Cart' });
    await sheet.getByTestId('cart-client').fill('Test Client A');
    await sheet.getByTestId('charge').click();
    const dialog = page.getByTestId('sale-success');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('success-another')).toHaveText('Log another sale');
    await expect(dialog.getByTestId('success-fulfilment')).toHaveText('Walk-in');
    await expect(dialog.getByTestId('success-line')).toHaveText(/1 × Plain/);
    await expect(dialog.getByTestId('success-total')).toHaveText(/UGX 5,000/);
    await expect(dialog.getByText(/Delivery fee/)).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2o-success-none.png` });
    await dialog.getByTestId('success-another').click();
    await expect(page.getByTestId('sale-success')).toHaveCount(0);
    await expect(page).toHaveURL(/\/next\/sell/);
  });

  test('Checkout shows a spinner and is disabled while saving, with the label unchanged', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Cart' });
    await sheet.getByTestId('cart-client').fill('Test Client A');
    const charge = sheet.getByTestId('charge');
    await page.waitForTimeout(500);
    const before = await charge.boundingBox();
    const label = await charge.innerText();
    driver.mock.setLatency(2500);
    await charge.click();
    await expect(charge).toBeDisabled();
    await expect(charge).toHaveAttribute('aria-busy', 'true');
    await expect(charge.locator('.v-btn__spinner')).toBeVisible();
    expect(await charge.innerText()).toBe(label);
    const during = await charge.boundingBox();
    expect(during!.width).toBe(before!.width);
    expect(during!.height).toBe(before!.height);
    await page.screenshot({ path: `${dir}/v2l-checkout-loading.png` });
    await expect(page.getByTestId('sale-success')).toBeVisible({ timeout: 15000 });
  });

  test('the spinner breathes instead of turning with reduced motion', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Cart' });
    await sheet.getByTestId('cart-client').fill('Test Client A');
    driver.mock.setLatency(2000);
    await sheet.getByTestId('charge').click();
    const name = await sheet.getByTestId('charge').locator('.v-btn__spinner').evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('v-breathe');
  });
});
