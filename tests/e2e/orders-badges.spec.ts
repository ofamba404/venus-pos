import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test('Orders: In sale and Closed cards wear a status tag, and the tabs carry counts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  const rows = driver.mock.db.table('store_orders');
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  await expect(page.getByTestId('seg-count-in_sale')).toHaveText(String(by('accepted')));

  await page.getByRole('tab', { name: /In sale/ }).click();
  const accepted = rows.find((r) => r.status === 'accepted')!;
  await expect(page.getByTestId(`status-${accepted.id}`)).toHaveText('In sale');
  expect(await page.getByTestId(`status-${accepted.id}`).evaluate((e) => e.className)).toContain('bronze');

  await page.getByRole('tab', { name: /Closed/ }).click();
  const cancelled = rows.find((r) => r.status === 'cancelled');
  if (cancelled) {
    await expect(page.getByTestId(`status-${cancelled.id}`)).toHaveText('Cancelled');
    expect(await page.getByTestId(`status-${cancelled.id}`).evaluate((e) => e.className)).toContain('danger');
  }
  const done = rows.find((r) => r.status === 'checked_out');
  if (done) await expect(page.getByTestId(`status-${done.id}`)).toHaveText('Completed');
  // The raw status word is gone from the card.
  await expect(page.locator('.order-card .v-list-row__meta', { hasText: /^(accepted|cancelled|checked_out|pending)$/ })).toHaveCount(0);

  // Plain tap highlight is off app-wide.
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('-webkit-tap-highlight-color'))).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
});
