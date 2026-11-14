import { expect, test } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const PENDING = 'seed-pending-order';

function confirmWrites(driver: Awaited<ReturnType<typeof createNextDriver>>) {
  return driver.mock.writes.filter(
    (w) => w.method === 'PATCH' && w.url.includes('store_orders') && (w.body as { status?: string })?.status === 'confirmed',
  );
}

for (const width of [360, 390]) {
  test(`Orders card: Confirm is the primary action of a pending order at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/orders');
    const card = page.locator('article.v-order-card', { has: page.getByTestId(`confirm-order-${PENDING}`) });
    const confirm = card.getByTestId(`confirm-order-${PENDING}`);
    const load = card.getByTestId(`view-order-${PENDING}`);
    const cancel = card.getByTestId(`cancel-order-${PENDING}`);
    await expect(confirm).toBeVisible();
    await expect(card.getByTestId(`confirmed-${PENDING}`)).toHaveCount(0);

    // Confirm, View order and Cancel are all reachable (44px) and nothing overflows the card.
    const box = await card.boundingBox();
    for (const el of [confirm, load, cancel]) {
      const b = (await el.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(43.5);
      expect(b.x).toBeGreaterThanOrEqual(box!.x - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
    }
    // Confirm sits on its own row above View order, and is the only filled (primary) pill.
    const cb = (await confirm.boundingBox())!;
    const lb = (await load.boundingBox())!;
    expect(cb.y + cb.height).toBeLessThanOrEqual(lb.y + 0.5);
    await expect(confirm).toHaveClass(/v-btn--primary/);
    await expect(load).toHaveClass(/v-btn--secondary/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('Orders card: Confirm writes status confirmed, shows the confirmed tag, and View order becomes primary', async ({ page }) => {
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`confirm-order-${PENDING}`).click();
  await expect(page.getByText('Order confirmed')).toBeVisible();
  await page.getByRole('tab', { name: /In sale/ }).click();
  const tag = page.getByTestId(`confirmed-${PENDING}`);
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText(/Confirmed/);
  await expect(tag).toHaveClass(/v-tag--paid/);
  await expect(tag).toHaveCSS('color', 'rgb(33, 33, 33)');
  await expect(page.getByTestId(`confirm-order-${PENDING}`)).toHaveCount(0);
  await expect(page.getByTestId(`view-order-${PENDING}`)).toHaveClass(/v-btn--primary/);

  const writes = confirmWrites(driver);
  expect(writes).toHaveLength(1);
  expect(writes[0].url).toContain(`id=eq.${PENDING}`);
  const body = writes[0].body as { status: string; confirmed_at: string };
  expect(body.status).toBe('confirmed');
  expect(Number.isNaN(Date.parse(body.confirmed_at))).toBe(false);
});

test('Orders card: a failed Confirm shows an error toast and keeps the button', async ({ page }) => {
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.route(/store_orders\?id=eq\./, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
      return;
    }
    await route.fallback();
  });
  await page.goto('/next/orders');
  await page.getByTestId(`confirm-order-${PENDING}`).click();
  await expect(page.getByText('Could not confirm order')).toBeVisible();
  await expect(page.getByTestId(`confirm-order-${PENDING}`)).toBeVisible();
  await expect(page.getByTestId(`confirmed-${PENDING}`)).toHaveCount(0);
  expect(confirmWrites(driver)).toHaveLength(0);
});

test('Orders card: an already confirmed order shows the tag and no Confirm button', async ({ page }) => {
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByRole('tab', { name: /In sale/ }).click();
  await expect(page.getByTestId('confirmed-so-confirmed-1')).toBeVisible();
  await expect(page.getByTestId('confirm-order-so-confirmed-1')).toHaveCount(0);
  await expect(page.getByTestId('view-order-so-confirmed-1')).toHaveClass(/v-btn--primary/);
});

test('Order sheet: a pending order can be confirmed there too, with the same write and the confirmed tag', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`view-order-${PENDING}`).click();
  const sheet = page.getByTestId('store-order-sheet');
  await expect(page.getByTestId('store-order-confirmed')).toHaveCount(0);
  await sheet.getByTestId('store-order-confirm').click();
  const tag = page.getByTestId('store-order-confirmed');
  await expect(tag).toHaveClass(/v-tag--paid/);
  await expect(tag).toHaveCSS('color', 'rgb(33, 33, 33)');
  await expect(sheet.getByTestId('store-order-confirm')).toHaveCount(0);
  const writes = confirmWrites(driver);
  expect(writes).toHaveLength(1);
  expect(writes[0].url).toContain(`id=eq.${PENDING}`);
  expect((writes[0].body as { confirmed_at?: string }).confirmed_at).toBeTruthy();
});

test('Order sheet: a failed Confirm toasts and keeps the button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`view-order-${PENDING}`).click();
  await page.route(/store_orders\?id=eq\./, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
      return;
    }
    await route.fallback();
  });
  await page.getByTestId('store-order-confirm').click();
  await expect(page.getByText('Could not confirm order')).toBeVisible();
  await expect(page.getByTestId('store-order-confirm')).toBeVisible();
  expect(confirmWrites(driver)).toHaveLength(0);
});
