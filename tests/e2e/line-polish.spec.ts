import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test.describe('Review sale polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the line photo is 64px, fills its frame, and a pack carries no ×1 chip', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await page.getByTestId('product-pilot').click();
    for (const f of ['mint', 'grape']) await page.getByTestId(`config-flavor-${f}-inc`).click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await sheet.waitFor();
    const gallery = sheet.getByTestId('line-gallery');
    const box = await gallery.locator('.v-gallery__viewport').boundingBox();
    expect(Math.round(box!.width)).toBe(64);
    expect(Math.round(box!.height)).toBe(64);
    const zoom = await gallery.locator('img').first().evaluate((el) => getComputedStyle(el).transform);
    expect(zoom).toMatch(/matrix\(1\.25/);
    await expect(sheet.locator('.v-cart-line').getByTestId('line-qty')).toHaveCount(0);
    expect(await sheet.locator('.v-qty').count()).toBe(0);
  });

  test('a quantity above one reads ×N beside the name', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    for (let i = 0; i < 2; i += 1) await page.getByTestId('config-qty-inc').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await expect(sheet.getByTestId('line-qty')).toHaveText('×3');
  });

  test('the disabled Checkout is muted ink, and the reason is quiet text with no coloured box', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-qty-inc').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    const charge = sheet.getByTestId('charge');
    await expect(charge).toBeDisabled();
    const reason = sheet.getByTestId('charge-reason');
    await expect(reason).toHaveText('Add a client to continue');
    const style = await charge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, shadow: cs.boxShadow, color: cs.color };
    });
    const rootStyle = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { melon: cs.getPropertyValue('--melon').trim(), tint: cs.getPropertyValue('--melon-tint').trim() };
    });
    const rgb = (hex: string) => {
      const h = hex.replace('#', '');
      return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
    };
    expect(style.bg).not.toBe(rgb(rootStyle.tint));
    expect(style.shadow).not.toContain(rgb(rootStyle.melon));
    const note = await reason.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(note).toBe('rgba(0, 0, 0, 0)');
  });
});

test('every order card with items has a photo gallery, including storefront-shaped orders', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId('order-gallery').first().waitFor();
  const cards = page.locator('article.order-card');
  const total = await cards.count();
  expect(total).toBeGreaterThan(1);
  await expect(page.locator('article.order-card .v-gallery')).toHaveCount(total);
  // so-pending-1 is a storefront order: product_id "cookie-duet", flavors ["mint", "chocolate"], no breakdown.
  const buyer = page.locator('article.order-card', { has: page.getByTestId('view-order-so-pending-1') });
  await expect(buyer).toHaveCount(1);
  const srcs = await buyer.locator('[data-gallery-index] img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src.split('/').pop()));
  expect(srcs).toEqual(['mint-cookie.webp', 'chocolate-cookie.webp']);
});
