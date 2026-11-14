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

async function assertCartFitsViewport(sheet: Awaited<ReturnType<typeof openCart>>, page: Page) {
  const vw = page.viewportSize()!.width;
  const overs = await sheet.evaluate((el, vw) => {
    const drawer = (el.closest('.v-sheet') as HTMLElement) || (el as HTMLElement);
    return Array.from(drawer.children).flatMap((node) => {
      const r = (node as HTMLElement).getBoundingClientRect();
      if (r.right <= vw + 0.5) return [];
      return [{ className: (node as HTMLElement).className, right: r.right, vw }];
    });
  }, vw);
  expect(overs, `overflow at ${vw}px: ${JSON.stringify(overs)}`).toEqual([]);
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
    await sheet.getByTestId('cart-client').blur();
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

  test('the cart drawer stays within the viewport at 360 and 390px while chips scroll', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    for (const width of [360, 390] as const) {
      await page.setViewportSize({ width, height: width === 360 ? 740 : 844 });
      const sheet = await openCart(page);
      await sheet.getByRole('tab', { name: 'Delivery' }).click();
      await sheet.getByTestId('cart-client').fill('Test Cli');
      await expect(sheet.getByTestId('add-client')).toBeVisible();
      await expect(sheet.getByRole('tab', { name: 'Paid' })).toHaveCount(0);
      const credit = sheet.getByTestId('credit-toggle');
      await expect(credit).toBeVisible();
      await expect(credit).toHaveAttribute('aria-checked', 'false');
      await expect(sheet.getByRole('tab', { name: 'Delivery' })).toBeVisible();
      await expect(sheet.getByRole('tab', { name: 'Pickup' })).toBeVisible();
      await assertCartFitsViewport(sheet, page);
      if (await sheet.getByRole('button', { name: 'Close' }).isVisible()) {
        await sheet.getByRole('button', { name: 'Close' }).click();
        await sheet.waitFor({ state: 'hidden' });
      }
    }
  });


  test('the cart has no Walk-in chip, Copy, Clear cart or Hold on this phone', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    const sheet = await openCart(page);
    await sheet.getByRole('tab', { name: 'Delivery' }).click();
    await expect(sheet.getByTestId('walk-in')).toHaveCount(0);
    await expect(sheet.getByTestId('copy-phone')).toHaveCount(0);
    await expect(sheet.getByTestId('copy-location')).toHaveCount(0);
    await expect(sheet.getByTestId('clear-cart')).toHaveCount(0);
    await expect(sheet.getByTestId('hold-sale')).toHaveCount(0);
    await expect(sheet.getByTestId('held-sales')).toHaveCount(0);
  });

  test('typing in Client filters the chips, highlights the match, and Add client appears when there is no exact name', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    const sheet = await openCart(page);
    const field = sheet.getByTestId('cart-client');
    await field.fill('Test Cli');
    const chips = sheet.getByTestId('client-chips');
    await expect(chips.getByText('Test Client A').first()).toBeVisible();
    await expect(chips.locator('strong').first()).toHaveText(/Test Cli/i);
    const name = chips.locator('.v-tag__name').filter({ hasText: 'Test Client A' }).first();
    await expect(name).toHaveText('Test Client A');
    const highlightGap = await name.evaluate((el) => {
      const strong = el.querySelector('strong');
      const rest = strong?.nextElementSibling as HTMLElement | null;
      if (!strong || !rest) return 0;
      return rest.getBoundingClientRect().left - strong.getBoundingClientRect().right;
    });
    expect(highlightGap).toBeLessThan(1);
    await expect(sheet.getByTestId('add-client')).toBeVisible();
    const row = chips.locator('.v-chip-row');
    const rowBox = (await row.boundingBox())!;
    const firstChip = (await row.locator('.v-tag').first().boundingBox())!;
    expect(rowBox.height).toBeLessThan(firstChip.height + 12);
    const styles = await row.evaluate((el) => {
      const s = getComputedStyle(el);
      return { wrap: s.flexWrap, overflowX: s.overflowX };
    });
    expect(styles.wrap).toBe('nowrap');
    expect(styles.overflowX).toMatch(/auto|scroll/);
    await chips.getByText('Test Client A').first().click();
    await expect(field).toHaveValue('Test Client A');
    await expect(sheet.getByTestId('add-client')).toHaveCount(0);
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

  test('store order cards show a time pill, Waiting vs In sale, and the sheet footer has Cancel', async ({ page }) => {
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
    await expect(page.getByTestId('store-order-cancel')).toBeVisible();
    await expect(page.getByTestId('store-order-checkout')).toBeVisible();
  });
});
