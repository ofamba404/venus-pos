import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

test('Orders: Waiting, In sale and Closed tabs; accepted orders sit in In sale with a Confirmed tag', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  const rows = driver.mock.db.table('store_orders');
  const closed = (r: { status?: unknown }) => r.status === 'cancelled' || r.status === 'checked_out';
  const inSale = (r: { status?: unknown; confirmed_at?: unknown }) =>
    !closed(r) && (r.status === 'confirmed' || r.status === 'accepted' || Boolean(r.confirmed_at));
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tab', { name: /In sale/ })).toBeVisible();
  await expect(page.getByTestId('seg-count-waiting')).toHaveText(String(rows.filter((r) => !closed(r) && !inSale(r)).length));
  await expect(page.getByTestId('seg-count-in_sale')).toHaveText(String(rows.filter(inSale).length));
  await expect(page.getByTestId('seg-count-closed')).toHaveText(String(rows.filter(closed).length));

  // An accepted order with no sale is In sale, reads Confirmed, and opens the same sheet.
  const accepted = rows.find((r) => r.status === 'accepted')!;
  await page.getByRole('tab', { name: /In sale/ }).click();
  await expect(page.getByTestId(`confirmed-${accepted.id}`)).toBeVisible();
  await expect(page.getByTestId(`confirm-order-${accepted.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`status-${accepted.id}`)).toHaveCount(0);
  await page.getByTestId(`view-order-${accepted.id}`).click();
  await expect(page.getByTestId('store-order-sheet')).toBeVisible();
  await expect(page.getByTestId('store-order-confirmed')).toBeVisible();
  await page.getByRole('dialog', { name: 'Store order' }).getByRole('button', { name: 'Close' }).click();

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

test('the Orders nav count is a red badge on the bag icon, and the label stays Orders', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/sell');
  const rows = driver.mock.db.table('store_orders');
  const open = rows.filter((r) => r.status !== 'cancelled' && r.status !== 'checked_out').length;
  const ordersBtn = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Orders' });
  await expect(ordersBtn).toBeVisible();
  const badge = page.getByTestId('orders-badge');
  await expect(badge).toHaveText(open > 9 ? '9+' : String(open));
  const icon = (await ordersBtn.locator('svg').boundingBox())!;
  const pill = (await badge.boundingBox())!;
  expect(Math.min(pill.width, pill.height)).toBeGreaterThanOrEqual(16);
  expect(pill.y + pill.height / 2).toBeLessThan(icon.y + icon.height / 2);
  expect(pill.x + pill.width / 2).toBeGreaterThan(icon.x + icon.width / 2);
  const style = await badge.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, weight: s.fontWeight, shadow: s.boxShadow };
  });
  expect(style.color).toBe('rgb(255, 255, 255)');
  expect(Number(style.weight)).toBeGreaterThanOrEqual(700);
  expect(style.shadow).toMatch(/255, 255, 255/);
  // Red badge (danger token).
  const [r, g, b] = (style.bg.match(/\d+/g) || []).map(Number);
  expect(r).toBeGreaterThan(g + 40);
  expect(r).toBeGreaterThan(b + 40);

  const table = driver.mock.db.table('store_orders');
  for (let i = 0; i < 10; i += 1) {
    table.unshift({
      id: `nav-extra-${i}`,
      status: 'pending',
      customer_name: `Extra ${i}`,
      created_at: new Date().toISOString(),
      confirmed_at: null,
      dismissed_at: null,
      sale_id: null,
      items: [],
    });
  }
  driver.mock.notifyRealtime();
  await expect(page.getByTestId('orders-badge')).toHaveText('9+');
});
