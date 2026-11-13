import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

async function sellOne(page: Page) {
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const sheet = page.getByRole('dialog', { name: 'Review sale' });
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
    await expect(dialog.getByTestId('success-total')).toHaveText(/UGX/);
    await expect(dialog.getByTestId('success-client')).toHaveText('Test Client A');
    await expect(dialog.getByTestId('success-label')).toHaveText('Sale recorded');
    // The store's mark: an ink ring and check, not a green blob.
    const stroke = await dialog.locator('.v-ok__mark-ring').evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).toBe('rgb(33, 33, 33)');
    await expect(dialog.locator('.v-success__check')).toHaveCount(0);
    await expect(dialog.getByText('Amount')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/v2m-success.png` });
    await dialog.getByTestId('success-done').click();
    await expect(page.getByTestId('sale-success')).toHaveCount(0);
    await expect(page).toHaveURL(/\/next\/sell/);
    await expect(page.getByTestId('cart-bar')).toHaveCount(0);
  });

  test('the close button, a scrim tap and Escape each dismiss it', async ({ page }) => {
    await sellOne(page);
    await expect(page.getByRole('dialog', { name: 'Review sale' })).toHaveCount(0);
    await page.getByRole('dialog', { name: 'Sale', exact: true }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('sale-success')).toHaveCount(0);

    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
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

  test('Log another sale goes to the counter, from any page', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/orders');
    await page.getByTestId('view-order-seed-pending-order').click();
    await page.getByTestId('store-order-checkout').click();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/v2l-store-order-checkout.png` });
    // Done leaves me on Orders.
    await page.getByTestId('success-done').click();
    await expect(page).toHaveURL(/\/next\/orders/);
    await expect(page.getByTestId('view-order-seed-pending-order')).toHaveCount(0);
    expect(driver.mock.writes.some((w) => w.url.includes('/rest/v1/sales'))).toBe(true);
  });

  test('Log another sale from Orders opens the counter', async ({ page }) => {
    await page.goto('/next/orders');
    await page.getByTestId('view-order-seed-pending-order').click();
    await page.getByTestId('store-order-checkout').click();
    await page.getByTestId('success-another').click();
    await expect(page).toHaveURL(/\/next\/sell/);
    await expect(page.getByTestId('sale-success')).toHaveCount(0);
  });

  test('Checkout shows a spinner and is disabled while saving, with the label unchanged', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
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
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await sheet.getByTestId('cart-client').fill('Test Client A');
    driver.mock.setLatency(2000);
    await sheet.getByTestId('charge').click();
    const name = await sheet.getByTestId('charge').locator('.v-btn__spinner').evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('v-breathe');
  });
});
