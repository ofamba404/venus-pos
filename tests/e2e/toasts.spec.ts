import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test.describe('toast audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('a toast sits clear of the Review sale bar', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/sell');
    for (const pair of [['mint', 'grape'], ['mint', 'mint']]) {
      await page.getByTestId('product-pilot').click();
      for (const f of pair) await page.getByTestId(`config-flavor-${f}-inc`).click();
      await page.getByTestId('config-add').click();
      await page.getByRole('dialog', { name: 'Review sale' }).waitFor();
      await page.getByRole('dialog', { name: 'Review sale' }).getByRole('button', { name: 'Close' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    await page.getByTestId('cart-bar').click();
    const dialog = page.getByRole('dialog', { name: 'Review sale' });
    await dialog.getByRole('button', { name: /^Remove/ }).first().click();
    const toast = page.locator('.v-toast');
    await expect(toast).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'hidden' });
    const bar = await page.getByTestId('cart-bar').boundingBox();
    const t = await toast.boundingBox();
    expect(bar).not.toBeNull();
    expect(t!.y + t!.height).toBeLessThanOrEqual(bar!.y - 8);
  });

  test('copy buttons confirm with a tick, not a toast', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/next/orders');
    const all = page.locator('[data-testid^="copy-all-"]').first();
    await all.click();
    await expect(all).toHaveClass(/is-done/);
    await expect(page.locator('.v-toast')).toHaveCount(0);
  });

  test('viewing an order opens the order sheet on Orders, with no toast', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/orders');
    await page.getByTestId('view-order-seed-pending-order').click();
    await expect(page.getByTestId('store-order-sheet')).toBeVisible();
    await expect(page.locator('.v-toast')).toHaveCount(0);
  });
});
