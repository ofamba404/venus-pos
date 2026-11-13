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
    await expect(dialog.getByText('Sale recorded')).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/v2k-success.png` });
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
    const box = (await page.getByRole('dialog', { name: 'Sale', exact: true }).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 30;
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
    await expect(page.locator('.v-sheet-scrim')).toHaveCount(0);
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
    await page.screenshot({ path: `${dir}/v2k-store-order-checkout.png` });
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
});
