import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { openSale } from './helpers/history';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';

/** An order with a mixed pilot, a variety and a cookie duet, the way the storefront builds one. */
const ORDER = {
  id: 'photo-order',
  status: 'confirmed',
  customer_name: 'Nabukeera Photo',
  phone_e164: '+256700555666',
  created_at: new Date().toISOString(),
  confirmed_at: new Date().toISOString(),
  dismissed_at: null,
  sale_id: null,
  items: [
    { product_id: 'pilot', product_name: 'Pilot Pack', detail: 'Mint, Grape', line_total: 15000, breakdown: { mint: 1, grape: 1 } },
    {
      product_id: 'cookie_duet',
      product_name: 'Cookie Duet',
      detail: 'Mint, Chocolate',
      line_total: 15000,
      breakdown: { cookie_mint: 1, cookie_chocolate: 1 },
    },
  ],
  delivery_enabled: false,
  location_label: null,
  location_lat: null,
  location_lng: null,
  delivery_fee_ugx: null,
};

async function addPack(page: Page, id: string, flavours: string[]) {
  await page.getByTestId(`product-${id}`).click();
  for (const f of flavours) await page.getByTestId(`config-flavor-${f}-inc`).click();
  await page.getByTestId('config-add').click();
  const sheet = page.getByRole('dialog', { name: 'Review sale' });
  await sheet.waitFor();
  return sheet;
}

test.describe('flavour photos once a pack is in an order', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Sell tiles stay on the normal pack photo, even with that pack in the cart', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    const tile = page.getByTestId('product-pilot');
    await expect(tile.locator('img.v-tile__img')).toHaveAttribute('src', /bestsellers-pilot-pack\.webp/);
    const sheet = await addPack(page, 'pilot', ['mint', 'grape']);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await sheet.waitFor({ state: 'hidden' });
    await expect(tile.locator('img.v-tile__img')).toHaveAttribute('src', /bestsellers-pilot-pack\.webp/);
    await expect(page.locator('.tile-grid .v-gallery')).toHaveCount(0);
  });

  test('a cart line shows each picked flavour as its own single-joint photo, whatever the pack', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    const sheet = await addPack(page, 'commander', ['watermelon', 'watermelon', 'blueberry', 'strawberry', 'strawberry']);
    const gallery = sheet.getByTestId('line-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '3');
    const srcs = await gallery.locator('[data-gallery-index] img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src.split('/').pop()));
    expect(srcs).toEqual(['scout-watermelon.webp', 'scout-blueberry.webp', 'scout-strawberry.webp']);
    await expect(gallery.locator('.v-gallery__qty').first()).toHaveText('×2');
  });

  test('an order card swipes through the whole order, one photo per flavour, cookies included', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.db.table('store_orders').push(ORDER);
    await page.goto('/next/orders');
    const card = page.locator('article', { has: page.getByTestId('view-order-photo-order') });
    const gallery = card.getByTestId('order-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '4');
    const srcs = await gallery.locator('[data-gallery-index] img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src.split('/').pop()));
    expect(srcs).toEqual(['scout-mint.webp', 'scout-grape.webp', 'mint-cookie.webp', 'chocolate-cookie.webp']);
    // The dots are pictures, not buttons, in a thin row below the 56px tile.
    await expect(gallery.locator('button')).toHaveCount(0);
    expect((await gallery.locator('.v-gallery__viewport').boundingBox())!.height).toBeLessThanOrEqual(56);
    expect((await gallery.boundingBox())!.height).toBeLessThanOrEqual(70);
  });

  test('a History row shows the sale\'s flavour photos, and so does its edit sheet', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/history');
    await page.locator('[data-testid^="history-day-toggle-"], [data-testid^="history-week-toggle-"]').first().waitFor();
    for (let i = 0; i < 20; i += 1) {
      if (await page.getByTestId('history-gallery').first().isVisible().catch(() => false)) break;
      const closed = page.locator('[data-testid^="history-week-toggle-"][aria-expanded="false"], [data-testid^="history-day-toggle-"][aria-expanded="false"]');
      if (!(await closed.count())) break;
      await closed.first().click();
      await page.waitForTimeout(60);
    }
    await expect(page.getByTestId('history-gallery').first()).toBeVisible();
    const srcs = await page.getByTestId('history-gallery').first().locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((s) => /scout-|cookie|plain|bestsellers/.test(s))).toBe(true);
    expect(srcs.some((s) => /pilot-|commanders-/.test(s))).toBe(false);
    await openSale(page, 'seed-sale-1');
    await page.getByTestId('sale-edit').click();
    const line = page.getByTestId('sale-edit-line-0').getByTestId('edit-line-gallery');
    await expect(line).toBeVisible();
    expect(await line.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src)).then((l) => l.some((s) => /pilot-|commanders-/.test(s)))).toBe(false);
  });
});

test('v2h shots at 390px: plain Sell tiles, a multi-flavour Review sale line, an order card', async ({ page }) => {
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  driver.mock.db.table('store_orders').push(ORDER);
  await page.goto('/next/sell');
  await page.getByTestId('product-pilot').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2h-sell-grid-plain.png` });
  const sheet = await addPack(page, 'commander', ['watermelon', 'watermelon', 'blueberry', 'strawberry', 'strawberry']);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/v2h-review-sale-line-1.png` });
  await sheet.getByTestId('line-gallery').locator('[data-dot="1"]').click({ force: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/v2h-review-sale-line-2.png` });
  // Footer: no client chosen, so Checkout is disabled and the reason is quiet text.
  await expect(sheet.getByTestId('charge')).toBeDisabled();
  await sheet.getByTestId('charge').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2h-review-footer.png` });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.getByTestId('product-pilot').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2h-sell-grid-with-pack-in-cart.png` });
  await page.goto('/next/orders');
  await page.getByTestId('view-order-photo-order').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2h-order-card-1.png` });
  await page.locator('article', { has: page.getByTestId('view-order-photo-order') }).getByTestId('gallery-track').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2, behavior: 'auto' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/v2h-order-card-2.png` });
  // The storefront-shaped Buyer One order (no breakdown) gets the same gallery.
  const buyer = page.locator('article.order-card', { has: page.getByTestId('view-order-so-pending-1') });
  await buyer.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/v2h-order-card-buyer-one.png` });
});
