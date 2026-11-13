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
    const load = card.getByTestId(`load-order-${PENDING}`);
    const cancel = card.getByTestId(`cancel-order-${PENDING}`);
    await expect(confirm).toBeVisible();
    await expect(card.getByTestId(`confirmed-${PENDING}`)).toHaveCount(0);

    // Confirm, Load into sale and Cancel are all reachable (44px) and nothing overflows the card.
    const box = await card.boundingBox();
    for (const el of [confirm, load, cancel]) {
      const b = (await el.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(43.5);
      expect(b.x).toBeGreaterThanOrEqual(box!.x - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
    }
    // Confirm sits on its own row above Load into sale, and is the only filled (primary) pill.
    const cb = (await confirm.boundingBox())!;
    const lb = (await load.boundingBox())!;
    expect(cb.y + cb.height).toBeLessThanOrEqual(lb.y + 0.5);
    await expect(confirm).toHaveClass(/v-btn--primary/);
    await expect(load).toHaveClass(/v-btn--secondary/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('Orders card: Confirm writes status confirmed, shows the green tag, and Load into sale becomes primary', async ({ page }) => {
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`confirm-order-${PENDING}`).click();

  const tag = page.getByTestId(`confirmed-${PENDING}`);
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText(/Confirmed/);
  await expect(tag).toHaveClass(/v-tag--paid/);
  await expect(page.getByTestId(`confirm-order-${PENDING}`)).toHaveCount(0);
  await expect(page.getByTestId(`load-order-${PENDING}`)).toHaveClass(/v-btn--primary/);
  await expect(page.getByText('Order confirmed')).toBeVisible();

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
  await expect(page.getByTestId('confirmed-so-confirmed-1')).toBeVisible();
  await expect(page.getByTestId('confirm-order-so-confirmed-1')).toHaveCount(0);
  await expect(page.getByTestId('load-order-so-confirmed-1')).toHaveClass(/v-btn--primary/);
});

test('Loaded-order card: Confirm uses the same write, flips to the green tag, and the buried button is gone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`load-order-${PENDING}`).click();
  await page.waitForURL(/\/sell/);

  const card = page.getByTestId('loaded-order');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('loaded-order-confirmed')).toHaveCount(0);
  await expect(card.getByTestId('loaded-order-confirm')).toHaveClass(/v-btn--primary/);
  // No separate Review button: the floating cart bar's Review sale is the one way in.
  await expect(card.getByTestId('loaded-order-review')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /Review/ })).toHaveCount(0);
  await expect(page.getByTestId('confirm-store-order')).toHaveCount(0);

  await card.getByTestId('loaded-order-confirm').click();
  await expect(card.getByTestId('loaded-order-confirmed')).toBeVisible();
  await expect(card.getByTestId('loaded-order-confirmed')).toHaveClass(/v-tag--paid/);
  await expect(card.getByTestId('loaded-order-confirm')).toHaveCount(0);
  await expect(page.getByText('Order confirmed')).toBeVisible();

  const writes = confirmWrites(driver);
  expect(writes).toHaveLength(1);
  expect(writes[0].url).toContain(`id=eq.${PENDING}`);
  expect((writes[0].body as { confirmed_at?: string }).confirmed_at).toBeTruthy();

  // The checkout sheet shows the same tag, has no Confirm paragraph, and keeps only Unlink.
  await page.getByTestId('cart-bar').click();
  const sheet = page.getByRole('dialog', { name: 'Review sale' });
  await expect(sheet.getByTestId('loaded-order-cart-confirmed')).toBeVisible();
  await expect(sheet.getByTestId('loaded-order-cart-confirm')).toHaveCount(0);
  await expect(sheet.getByTestId('confirm-store-order')).toHaveCount(0);
  await expect(sheet.getByText(/Confirm tells the store/)).toHaveCount(0);
  await expect(sheet.getByTestId('release-store-order')).toBeVisible();
});

test('Checkout sheet: a pending loaded order can be confirmed there too, and a failure toasts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const driver = await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`load-order-${PENDING}`).click();
  await page.waitForURL(/\/sell/);
  await page.getByTestId('cart-bar').click();
  const sheet = page.getByRole('dialog', { name: 'Review sale' });

  await page.route(/store_orders\?id=eq\./, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
      return;
    }
    await route.fallback();
  });
  await sheet.getByTestId('loaded-order-cart-confirm').click();
  await expect(page.getByText('Could not confirm order')).toBeVisible();
  await expect(sheet.getByTestId('loaded-order-cart-confirm')).toBeVisible();
  expect(confirmWrites(driver)).toHaveLength(0);
});

test('A confirmed order that is loaded into the sale stays in the In sale tab, and Unlink keeps it in Orders', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_staff' });
  await page.goto('/next/orders');
  await page.getByTestId(`load-order-${PENDING}`).click();
  await page.waitForURL(/\/sell/);
  await page.getByTestId('loaded-order-confirm').click();
  await expect(page.getByTestId('loaded-order-confirmed')).toBeVisible();

  await page.goto('/next/orders');
  await page.getByRole('tab', { name: 'In sale' }).click();
  await expect(page.getByTestId(`load-order-${PENDING}`)).toHaveText('Review sale');
  await expect(page.getByTestId(`confirmed-${PENDING}`)).toBeVisible();
  await page.getByRole('tab', { name: 'Waiting' }).click();
  await expect(page.getByTestId(`load-order-${PENDING}`)).toHaveCount(0);

  await page.getByRole('tab', { name: 'In sale' }).click();
  // Review sale opens the cart sheet in place. Close it to reach the card's Unlink.
  await page.getByTestId(`load-order-${PENDING}`).click();
  await page.waitForURL(/\/sell/);
  const reviewSheet = page.getByRole('dialog', { name: 'Review sale' });
  await expect(reviewSheet).toBeVisible();
  await reviewSheet.getByRole('button', { name: 'Close' }).click();
  await reviewSheet.waitFor({ state: 'hidden' });
  await page.getByTestId('loaded-order-unlink').click();
  // Unlink does not cancel or release the order. It is still in Orders, still confirmed.
  await page.getByTestId('loaded-order').waitFor({ state: 'detached' });
  await page.goto('/next/orders');
  // Unlinked, it goes back to Waiting to be loaded again.
  await expect(page.getByTestId(`load-order-${PENDING}`)).toHaveText('Load into sale');
  await expect(page.getByTestId(`confirmed-${PENDING}`)).toBeVisible();
  await expect(page.getByTestId('cancelled-banner')).toHaveCount(0);
});
