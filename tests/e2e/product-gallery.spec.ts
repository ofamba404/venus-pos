import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

async function addPilot(page: import('@playwright/test').Page, flavours: string[]) {
  await page.goto('/next/sell');
  await page.getByTestId('product-pilot').click();
  for (const f of flavours) await page.getByTestId(`config-flavor-${f}-inc`).click();
  await page.getByTestId('config-add').click();
  await page.getByRole('dialog', { name: 'Review sale' }).waitFor();
}

test.describe('flavour photo gallery on cart lines', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('a pack with several flavours shows one photo per flavour, dots, and swipes on a dot tap', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createNextDriver(page, { role: 'pos_admin' });
    await addPilot(page, ['mint', 'grape']);
    const gallery = page.getByRole('dialog', { name: 'Review sale' }).getByTestId('line-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '2');
    const imgs = gallery.locator('img');
    await expect(imgs).toHaveCount(2);
    await expect(imgs.nth(0)).toHaveAttribute('src', /pilot-mint\.webp/);
    await expect(imgs.nth(1)).toHaveAttribute('src', /pilot-grape\.webp/);
    const track = gallery.getByTestId('gallery-track');
    await expect(gallery.locator('.v-gallery__dot.is-active')).toHaveAttribute('data-dot', '0');
    await gallery.locator('[data-dot="1"]').click({ force: true });
    await expect.poll(() => track.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth))).toBe(1);
    await expect(gallery.locator('.v-gallery__dot.is-active')).toHaveAttribute('data-dot', '1');
    // Reduced motion: it stays where the thumb left it.
    await page.waitForTimeout(3300);
    await expect(gallery.locator('.v-gallery__dot.is-active')).toHaveAttribute('data-dot', '1');
  });

  test('it advances by itself, and loops back to the first photo', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await addPilot(page, ['mint', 'grape']);
    const gallery = page.getByRole('dialog', { name: 'Review sale' }).getByTestId('line-gallery');
    await expect(gallery.locator('.v-gallery__dot.is-active')).toHaveAttribute('data-dot', '1', { timeout: 6000 });
    await expect(gallery.locator('.v-gallery__dot.is-active')).toHaveAttribute('data-dot', '0', { timeout: 6000 });
  });

  test('one flavour is a single plain photo with no dots, and a count badge when more than one', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await addPilot(page, ['mint', 'mint']);
    const gallery = page.getByRole('dialog', { name: 'Review sale' }).getByTestId('line-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '1');
    await expect(gallery.locator('.v-gallery__dot')).toHaveCount(0);
    await expect(gallery.locator('img')).toHaveAttribute('src', /pilot-mint\.webp/);
    await expect(gallery.locator('.v-gallery__qty')).toHaveText('×2');
  });
});
