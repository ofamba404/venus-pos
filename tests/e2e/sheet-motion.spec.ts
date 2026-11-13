import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

/**
 * Sheets and drawers use the storefront cart drawer's motion: panel 800ms ease-out in, scrim 400ms fade,
 * a 480ms ease-out on close, and the sheet stays mounted until that finishes. Reduced motion skips all of it.
 */
async function openScout(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').click();
  return page.getByRole('dialog', { name: 'Scout Pack' });
}

test('a sheet slides in and out with the store drawer timing, then unmounts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const sheet = await openScout(page);
  await expect(sheet).toBeVisible();
  const timing = await sheet.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, duration: cs.animationDuration };
  });
  expect(timing).toEqual({ name: 'v-sheet-up', duration: '0.8s' });
  const scrim = await page.locator('.v-sheet-scrim').evaluate((el) => getComputedStyle(el).animationDuration);
  expect(scrim).toBe('0.4s');

  await sheet.getByRole('button', { name: 'Close' }).click();
  // Still on screen, now playing the close.
  await expect(sheet).toHaveClass(/is-closing/);
  const closing = await sheet.evaluate((el) => getComputedStyle(el).animationDuration);
  expect(closing).toBe('0.48s');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.v-sheet-scrim')).toHaveCount(0);
});

test('with reduced motion a sheet just appears and disappears', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sheet = await openScout(page);
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0, { timeout: 150 });
});
