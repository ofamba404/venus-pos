import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

async function addPilot(page: import('@playwright/test').Page, flavours: string[]) {
  await page.getByTestId('product-pilot').click();
  for (const f of flavours) await page.getByTestId(`config-flavor-${f}-inc`).click();
  await page.getByTestId('config-add').click();
  const sheet = page.getByRole('dialog', { name: 'Review sale' });
  await sheet.waitFor();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await sheet.waitFor({ state: 'hidden' });
}

test.describe('Sell pack tile flavour gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('a pack with flavours in the cart swipes through their photos; other tiles stay plain', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    const tile = page.getByTestId('product-pilot');
    await expect(tile.getByTestId('tile-gallery')).toHaveCount(0);
    await expect(tile.locator('img.v-tile__img')).toHaveCount(1);
    await addPilot(page, ['mint', 'grape']);
    const gallery = tile.getByTestId('tile-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '2');
    await expect(gallery.locator('img').nth(0)).toHaveAttribute('src', /pilot-mint\.webp/);
    await expect(gallery.locator('img').nth(1)).toHaveAttribute('src', /pilot-grape\.webp/);
    await expect(tile.locator('img.v-tile__img')).toHaveCount(0);
    await expect(page.getByTestId('product-scout').getByTestId('tile-gallery')).toHaveCount(0);
    // The dots are pictures, not buttons: the tile is one button.
    await expect(gallery.locator('button')).toHaveCount(0);
    // Swiping moves the active dot.
    const track = gallery.getByTestId('gallery-track');
    await track.evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: 'auto' }));
    await expect(gallery.locator('.v-gallery__dot.is-active')).toHaveCount(1);
    await expect.poll(() => gallery.locator('.v-gallery__dot').nth(1).getAttribute('class')).toContain('is-active');
    // Reduced motion: it stays where the thumb left it.
    await page.waitForTimeout(3300);
    await expect.poll(() => gallery.locator('.v-gallery__dot').nth(1).getAttribute('class')).toContain('is-active');
    // Tapping the tile still opens the picker.
    await tile.click();
    await expect(page.getByTestId('config-add')).toBeVisible();
  });

  test('it advances by itself, loops, and matches the neutral white tile', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await addPilot(page, ['mint', 'grape']);
    const gallery = page.getByTestId('product-pilot').getByTestId('tile-gallery');
    const second = () => gallery.locator('.v-gallery__dot').nth(1).getAttribute('class');
    const first = () => gallery.locator('.v-gallery__dot').nth(0).getAttribute('class');
    await expect.poll(second, { timeout: 7000 }).toContain('is-active');
    await expect.poll(first, { timeout: 7000 }).toContain('is-active');
    const bg = await gallery.locator('.v-gallery__viewport').evaluate((el) => getComputedStyle(el).backgroundColor);
    const tileBg = await page.getByTestId('product-pilot').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(tileBg);
    const box = await gallery.boundingBox();
    expect(Math.round(box!.height)).toBeLessThanOrEqual(104);
  });

  test('one flavour shows that flavour with a count, and removing the line restores the pack photo', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await addPilot(page, ['mint', 'mint']);
    const tile = page.getByTestId('product-pilot');
    const gallery = tile.getByTestId('tile-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '1');
    await expect(gallery.locator('img')).toHaveAttribute('src', /pilot-mint\.webp/);
    await expect(gallery.locator('.v-gallery__qty')).toHaveText('×2');
    await page.getByTestId('cart-bar').click();
    await page.getByRole('dialog', { name: 'Review sale' }).getByRole('button', { name: /^Remove/ }).first().click();
    await expect(tile.getByTestId('tile-gallery')).toHaveCount(0);
    await expect(tile.locator('img.v-tile__img')).toHaveCount(1);
  });

  test('two lines of the same pack combine their flavours on the tile', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await addPilot(page, ['mint', 'grape']);
    await addPilot(page, ['strawberry', 'strawberry']);
    const gallery = page.getByTestId('product-pilot').getByTestId('tile-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '3');
  });
});
