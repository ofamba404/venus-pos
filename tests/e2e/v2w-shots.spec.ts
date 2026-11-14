import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

const dir = '/workspace/shots3';

function confirmedOrder(id: string, name: string, lineTotal: number, items: unknown[]) {
  return {
    id,
    status: 'accepted',
    customer_name: name,
    phone_e164: '+256700111222',
    created_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    dismissed_at: null,
    sale_id: null,
    items,
    delivery_enabled: false,
    delivery_fee_ugx: null,
  };
}

const primeItems = [
  { product_id: 'plain_single', product_name: 'Plain', line_total: 5000, breakdown: { mint: 1 } },
];
const adaItems = [
  {
    product_id: 'pilot',
    store_product_id: 'pilot-pack',
    product_name: 'Pilot Pack',
    detail: 'Mint ×2, Grape ×1',
    quantity: 1,
    line_total: 15000,
    breakdown: { mint: 2, grape: 1 },
  },
];

async function addPlainToCart(page: Page) {
  await page.goto('/next/sell');
  await page.getByTestId('product-plain_single').click();
  await page.getByTestId('config-add').click();
  return page.getByRole('dialog', { name: 'Cart' });
}

test.describe('v2w sign-in, credit, hours, review bar, password, gallery', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('sign-in has a circular logo, Venus POS as subtext, and a Sign in heading', async ({ page }) => {
    await page.goto('/next/auth.html');
    const title = page.getByRole('heading', { name: 'Sign in' });
    await title.waitFor();
    await expect(page.getByText('Venus POS')).toBeVisible();
    await expect(page.getByText('The register for the Venus team.')).toHaveCount(0);
    const logo = page.locator('.auth-logo');
    const box = (await logo.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    const radius = await logo.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toBe('50%');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/v2w-signin.png` });
  });

  test('the cart uses a quiet On credit switch, off by default, and records is_credit', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    const sheet = await addPlainToCart(page);
    await expect(sheet.getByRole('tab', { name: 'Paid' })).toHaveCount(0);
    const toggle = sheet.getByTestId('credit-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await sheet.getByTestId('cart-client').fill('Test Client A');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/v2w-cart-credit.png` });

    await sheet.getByTestId('charge').click();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    const paid = driver.mock.writes.find((w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'))!;
    expect((paid.body as { is_credit?: boolean }).is_credit).toBe(false);

    await page.getByTestId('success-done').click();
    const sheet2 = await addPlainToCart(page);
    await sheet2.getByTestId('cart-client').fill('Test Client A');
    await sheet2.getByTestId('credit-toggle').click();
    await expect(sheet2.getByTestId('credit-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(sheet2.getByTestId('charge')).toContainText('Record on credit');
    await sheet2.getByTestId('charge').click();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    const credit = driver.mock.writes.filter((w) => w.method === 'POST' && w.url.includes('/rest/v1/sales')).at(-1)!;
    expect((credit.body as { is_credit?: boolean }).is_credit).toBe(true);
  });

  test('the hours sheet has no Clients see preview', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/sell');
    await page.getByTestId('store-status-btn').click();
    await expect(page.getByRole('dialog', { name: 'Hours' })).toBeVisible();
    await expect(page.getByTestId('hours-preview')).toHaveCount(0);
    await expect(page.getByText('Clients see')).toHaveCount(0);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/v2w-hours.png` });
  });

  test('the review bar names one order and totals several, and the sheet toggles and advances', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    const orders = driver.mock.db.table('store_orders');
    for (let i = orders.length - 1; i >= 0; i--) {
      const row = orders[i] as { status?: string; confirmed_at?: string };
      if (row.confirmed_at || row.status === 'confirmed' || row.status === 'accepted') orders.splice(i, 1);
    }
    orders.push(confirmedOrder('so-prime', 'Venus Prime', 5000, primeItems));
    await page.goto('/next/sell');
    const bar = page.getByTestId('review-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByText('Venus Prime · 1 item · UGX 5,000')).toBeVisible();
    await expect(bar.locator('.review-bar__cta')).toHaveText('Review');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/v2w-sell-bars.png` });

    driver.mock.db.table('store_orders').push(confirmedOrder('so-ada', 'Ada', 15000, adaItems));
    await page.reload();
    await expect(bar).toContainText('2 orders · UGX 20,000');
    await expect(bar.locator('.review-bar__cta')).toHaveText('Review');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${dir}/v2w-sell-bars-multi.png` });

    await bar.click();
    const sheet = page.getByTestId('store-order-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('store-order-name')).toHaveText('Venus Prime');
    await expect(page.getByTestId('store-order-queue')).toBeVisible();
    await expect(page.getByTestId('store-order-chip-so-prime')).toHaveClass(/is-active/);
    await expect(page.getByTestId('store-order-cancel')).toBeVisible();
    await page.getByTestId('store-order-chip-so-ada').click();
    await expect(page.getByTestId('store-order-name')).toHaveText('Ada');
    await expect(page.getByTestId('store-order-chip-so-ada')).toHaveClass(/is-active/);
    await expect(page.getByTestId('store-order-cancel')).toBeInViewport();
    await expect(page.getByTestId('store-order-checkout')).toBeInViewport();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/v2w-store-order-multi.png` });

    await page.getByTestId('store-order-checkout').click();
    await expect(page.getByTestId('sale-success')).toBeVisible();
    await page.getByTestId('success-done').click();
    await expect(page.getByTestId('store-order-sheet')).toBeVisible();
    await expect(page.getByTestId('store-order-name')).toHaveText('Venus Prime');
    await expect(page.getByTestId('review-bar')).toContainText('Venus Prime · 1 item · UGX 5,000');
  });

  test('Settings offers Change password for staff and owner, with inline errors and a success toast', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/settings');
    await page.getByTestId('change-password').click();
    const sheet = page.getByRole('dialog', { name: 'Change password' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/v2w-change-password.png` });

    await sheet.getByTestId('change-password-current').fill('old-pass');
    await sheet.getByTestId('change-password-new').fill('short');
    await sheet.getByTestId('change-password-confirm').fill('different');
    await sheet.getByTestId('change-password-save').click();
    await expect(sheet.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(sheet.getByText('Those passwords do not match.')).toBeVisible();

    await sheet.getByTestId('change-password-new').fill('new-pass-1');
    await sheet.getByTestId('change-password-confirm').fill('new-pass-1');
    driver.mock.setFailure({ method: 'POST', pathIncludes: '/auth/v1/token', status: 400 });
    await sheet.getByTestId('change-password-save').click();
    await expect(sheet.getByText('Wrong current password.')).toBeVisible();

    await sheet.getByTestId('change-password-save').click();
    await expect(page.getByText('Password updated')).toBeVisible();
    await expect(sheet).toBeHidden();

    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/settings');
    await expect(page.getByTestId('change-password')).toBeVisible();
  });

  test('order cards keep a stable box across a gallery tick and a store-orders poll', async ({ page }) => {
    test.setTimeout(30_000);
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    driver.mock.db.table('store_orders').push(
      confirmedOrder('so-glide', 'Slider Client', 15000, adaItems),
    );
    await page.goto('/next/orders');
    await page.getByRole('tab', { name: /In sale/ }).click();
    const card = page.getByTestId('order-card-so-glide');
    await card.waitFor();
    const gallery = card.getByTestId('order-gallery');
    await expect(gallery).toHaveAttribute('data-slides', '2');
    // Let the card entrance animation finish before measuring.
    await page.waitForTimeout(600);
    const before = (await card.boundingBox())!;
    // One autoplay tick (2.8s) plus the 4s store-orders poll. The card must not jump, and
    // the track must not have been reset to the clone at scrollLeft 0.
    await page.waitForTimeout(4500);
    const after = (await card.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    expect(Math.abs(after.width - before.width)).toBeLessThan(2);
    expect(Math.abs(after.height - before.height)).toBeLessThan(2);
    const scroll = await gallery.getByTestId('gallery-track').evaluate((el) => el.scrollLeft);
    expect(scroll).toBeGreaterThan(8);
  });
});
