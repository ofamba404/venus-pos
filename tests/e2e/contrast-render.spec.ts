import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createNextDriver } from './drivers/next';

async function contrast(page: Page) {
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => {
      const d = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
      return `${n.target.join(' ')} ${d?.fgColor} on ${d?.bgColor} = ${d?.contrastRatio}`;
    }),
  );
}

test.describe('rendered contrast on the screens with tints', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
  });

  for (const path of ['/next/orders', '/next/insights', '/next/history', '/next/stock', '/next/clients', '/next/cookie-partner']) {
    test(`${path} has no contrast failures`, async ({ page }) => {
      await createNextDriver(page, { role: 'pos_admin' });
      await page.goto(path);
      await page.locator('h1').first().waitFor();
      expect(await contrast(page)).toEqual([]);
    });
  }

  test('a loaded delivery order: Sell, the card, and the checkout sheet', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!.items = [
      { product_id: 'variety', product_name: 'Variety Pack', line_total: 50000, breakdown: { mint: 1, strawberry: 1, blueberry: 1, watermelon: 1, grape: 1, coconut: 1, melon: 1, classic: 1 } },
    ];
    await page.goto('/next/orders');
    await page.getByTestId('load-order-so-confirmed-1').click();
    await page.waitForURL(/\/sell/);
    await page.getByTestId('loaded-order').waitFor();
    expect(await contrast(page)).toEqual([]);
    await page.getByTestId('cart-bar').click();
    await page.getByRole('dialog', { name: 'Review sale' }).waitFor();
    expect(await contrast(page)).toEqual([]);
  });

  test('Clients: a merged person sheet with the delete confirmation, and the Add item views', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    driver.mock.db.table('store_accounts').push({ id: 'acc-debt', phone: '+256700333444', pos_display_name: 'Debt Storefront', verified: false });
    await page.goto('/next/clients');
    await page.getByRole('button', { name: /Client With Debt/ }).first().click();
    await page.getByTestId('person-sheet').waitFor();
    expect(await contrast(page)).toEqual([]);
    await page.getByTestId('client-delete').click();
    await page.getByTestId('client-delete-confirm').waitFor();
    expect(await contrast(page)).toEqual([]);

    await page.goto('/next/history');
    await page.getByTestId('history-sale-seed-sale-1').click();
    await page.getByTestId('sale-edit').click();
    expect(await contrast(page)).toEqual([]);
    await page.getByTestId('sale-edit-add').click();
    await page.getByTestId('sale-add-catalog').waitFor();
    expect(await contrast(page)).toEqual([]);
    await page.getByTestId('product-pilot').click();
    expect(await contrast(page)).toEqual([]);
  });

  test('Insights: money chart with a bar picked, restock list open, credit open with orders and the settle sheet', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    driver.mock.db.table('inventory').find((r) => r.category_id === 'mint')!.stock = 1;
    await page.goto('/next/insights');
    await page.getByTestId('money-chart').waitFor();
    await page.getByRole('button', { name: '1M', exact: true }).click();
    expect(await contrast(page)).toEqual([]);
    await page.getByTestId('money-bar').nth(0).click();
    expect(await contrast(page)).toEqual([]);
    await page.getByTestId('restock-fine-toggle').click();
    expect(await contrast(page)).toEqual([]);
    await page.getByTestId('credit-toggle').click();
    await page.locator('[data-testid^="credit-person-"]').first().click();
    expect(await contrast(page)).toEqual([]);
    await page.locator('[data-testid^="credit-settle-order-"]').first().click();
    await page.getByTestId('credit-settle-sheet').waitFor();
    expect(await contrast(page)).toEqual([]);
  });

  test('the sign-in page', async ({ page }) => {
    await page.goto('/next/auth.html');
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    expect(await contrast(page)).toEqual([]);
  });
});
