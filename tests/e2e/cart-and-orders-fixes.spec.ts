import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

async function openCart(page: Page) {
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  const config = page.getByRole('dialog', { name: 'Plain' });
  await config.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  if (!(await page.getByRole('dialog', { name: 'Cart' }).isVisible().catch(() => false))) {
    await page.getByTestId('cart-bar').click();
  }
  const sheet = page.getByRole('dialog', { name: 'Cart' });
  await sheet.waitFor();
  return sheet;
}

test.describe('cart and orders fixes', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('cart is titled Cart, has no Deliver at or Copy all, and does not overflow at 360px', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.setViewportSize({ width: 360, height: 740 });
    const sheet = await openCart(page);
    await sheet.getByRole('tab', { name: 'Delivery' }).click();
    await sheet.getByTestId('cart-client').fill('Test Client A');
    await expect(sheet.getByText('Deliver at', { exact: true })).toHaveCount(0);
    await expect(sheet.getByTestId('copy-all')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Review sale' })).toHaveCount(0);
    const sheetEl = (await sheet.evaluateHandle((el) => el.closest('.v-sheet') || el)).asElement()!;
    const overflow = await sheetEl.evaluate((box) => {
      const parent = box.getBoundingClientRect();
      const selectors = ['.v-field-copy', '.v-seg', '.cart-total', '.v-copy-btn', '.v-phone', '.v-place'];
      return selectors.some((sel) =>
        Array.from(box.querySelectorAll<HTMLElement>(sel)).some((node) => {
          const r = node.getBoundingClientRect();
          return r.right > parent.right + 2 || r.left < parent.left - 2;
        }),
      ) || box.scrollWidth > box.clientWidth + 2;
    });
    expect(overflow).toBe(false);
    const delivery = sheet.locator('.delivery-block');
    const bg = await delivery.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || bg === 'rgb(255, 255, 255)' || bg === 'rgb(250, 250, 248)').toBe(true);
  });

  test('clear cart empties the sale and Undo puts it back', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    const sheet = await openCart(page);
    await sheet.getByTestId('cart-client').fill('Nakato');
    await sheet.getByTestId('clear-cart').click();
    await expect(sheet.getByText('No items yet')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(sheet.getByTestId('line-gallery')).toBeVisible();
    await expect(sheet.getByTestId('cart-client')).toHaveValue('Nakato');
  });

  test('typing in Client shows matching clients and picking one fills the field', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    const sheet = await openCart(page);
    const field = sheet.getByTestId('cart-client');
    await field.click();
    await field.fill('Test Cli');
    const list = sheet.getByTestId('client-suggest');
    await expect(list).toBeVisible({ timeout: 10_000 });
    await expect(list.getByText('Test Client A')).toBeVisible();
    await list.getByText('Test Client A').click();
    await expect(sheet.getByTestId('cart-client')).toHaveValue('Test Client A');
    await expect(list).toHaveCount(0);
  });

  test('the ×N badge sits at the top right of the photo', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.db.table('store_orders').push({
      id: 'so-badge',
      status: 'pending',
      customer_name: 'Badge Buyer',
      items: [{ product_id: 'cookie-duet', name: 'Cookie Duet', quantity: 1, flavors: ['mint', 'mint'] }],
      delivery_enabled: false,
    });
    await page.goto('/next/orders');
    await page.getByTestId('view-order-so-badge').click();
    const gallery = page.getByTestId('so-gallery').first();
    const qty = gallery.locator('.v-gallery__qty');
    await expect(qty).toBeVisible();
    const photo = (await gallery.locator('.v-gallery__viewport').boundingBox())!;
    const badge = (await qty.boundingBox())!;
    expect(badge.y + badge.height / 2).toBeLessThan(photo.y + photo.height / 2);
    expect(badge.x).toBeGreaterThan(photo.x + photo.width / 2);
  });

  test('store order cards show a time pill, Waiting vs In sale, and the sheet footer has no Cancel', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/orders');
    await expect(page.getByRole('tab', { name: /Waiting/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /In sale/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Closed/ })).toBeVisible();
    await expect(page.getByTestId('cancel-order-seed-pending-order')).toBeVisible();

    await page.getByRole('tab', { name: /In sale/ }).click();
    await expect(page.getByTestId('time-pill-so-confirmed-1')).toHaveText('4:30 PM');
    await expect(page.getByTestId('order-card-so-confirmed-1')).toBeVisible();
    await page.getByTestId('view-order-so-confirmed-1').click();
    const sheet = page.getByTestId('store-order-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('store-order-cancel')).toHaveCount(0);
    await expect(page.getByTestId('store-order-checkout')).toBeVisible();
  });
});
