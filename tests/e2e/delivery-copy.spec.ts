import { test, expect, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { openSale } from './helpers/history';

const MAP = 'https://www.google.com/maps/search/?api=1&query=0.33,32.59';

async function clip(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('SafeBoda copy pills', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Orders list card keeps only Copy all: a labelled 44px pill with the exact text', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/next/orders');
    const all = page.getByTestId('copy-all-so-confirmed-1');
    await expect(all).toHaveText('Copy all');
    expect(Math.round((await all.boundingBox())!.height)).toBe(44);
    // Copy phone and Copy location are gone from every Orders card. They live in the order sheet and in checkout.
    await expect(page.locator('[data-testid^="copy-phone-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="copy-location-"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await all.click();
    // The tick is the confirmation. No toast on top of it.
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(all).toHaveClass(/is-done/);
    // Store orders carry no paid / unpaid field, so there is never a Collect line here.
    expect(await clip(page)).toBe(['Name: Test Buyer Two', 'Phone: 700654321', 'Drop-off: Kololo Test', `Map: ${MAP}`].join('\n'));
  });

  test('no icon-only copy buttons anywhere', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/orders');
    await expect(page.getByTestId('copy-all-seed-pending-order')).toBeVisible();
    const buttons = page.locator('.v-copy-btn');
    expect(await buttons.count()).toBeGreaterThan(0);
    for (const text of await buttons.allInnerTexts()) expect(text.trim().length).toBeGreaterThan(0);
  });

  test('a pickup order card also has just Copy all, with name and phone', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/next/orders');
    await expect(page.getByTestId('copy-all-seed-pending-order')).toBeVisible();
    await expect(page.getByTestId('copy-phone-seed-pending-order')).toHaveCount(0);
    await expect(page.getByTestId('copy-location-seed-pending-order')).toHaveCount(0);
    await page.getByTestId('copy-all-seed-pending-order').click();
    expect(await clip(page)).toBe('Name: Store Customer\nPhone: 700000099');
  });

  test('the sale sheet copies the same way, and collects only what is still owed', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const sale = driver.mock.db.table('sales').find((r) => r.id === 'seed-sale-1')!;
    sale.client_phone = '0700333444';
    sale.delivery_enabled = true;
    sale.location_label = 'Kololo, behind the blue gate';
    sale.location_lat = 0.33;
    sale.location_lng = 32.59;
    await page.goto('/next/history');
    await openSale(page, 'seed-sale-1');
    const all = page.getByTestId('history-copy-all');
    for (const id of ['history-copy-phone', 'history-copy-location', 'history-copy-all']) {
      expect(Math.round((await page.getByTestId(id).boundingBox())!.height)).toBe(44);
    }
    await page.getByTestId('history-copy-phone').click();
    expect(await clip(page)).toBe('700333444');
    await page.getByTestId('history-copy-location').click();
    expect(await clip(page)).toBe(`Kololo, behind the blue gate\n${MAP}`);
    // Paid: nothing to collect.
    await all.click();
    expect(await clip(page)).toBe(
      ['Name: Test Client A', 'Phone: 700333444', 'Drop-off: Kololo, behind the blue gate', `Map: ${MAP}`].join('\n'),
    );
    // On credit and not cleared: the rider collects what is still owed.
    const collect = async () => {
      await page.keyboard.press('Escape');
      await page.reload();
      await openSale(page, 'seed-sale-1');
      await page.getByTestId('history-copy-all').click();
      return clip(page);
    };
    sale.is_credit = true;
    sale.credit_cleared = false;
    sale.amount_paid_ugx = 0;
    expect(await collect()).toContain('Collect: UGX 8,000');
    // Part paid: only the balance.
    sale.amount_paid_ugx = 3000;
    expect(await collect()).toContain('Collect: UGX 5,000');
    // Credit that has been cleared is paid: nothing to collect.
    sale.credit_cleared = true;
    expect(await collect()).not.toContain('Collect');
    // Paid in full on credit terms: nothing either.
    sale.credit_cleared = false;
    sale.amount_paid_ugx = 8000;
    expect(await collect()).not.toContain('Collect');
  });

  test('a pickup sale shows Copy phone only', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    const sale = driver.mock.db.table('sales').find((r) => r.id === 'seed-sale-1')!;
    sale.client_phone = '0700333444';
    await page.goto('/next/history');
    await openSale(page, 'seed-sale-1');
    await expect(page.getByTestId('history-copy-phone')).toBeVisible();
    await expect(page.getByTestId('history-copy-location')).toHaveCount(0);
    await expect(page.getByTestId('history-copy-all')).toHaveCount(0);
  });

  test('checkout delivery block copies what is typed now', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await sheet.getByRole('tab', { name: 'Delivery' }).click();
    await sheet.getByTestId('cart-client').fill('Nakato');
    await sheet.getByTestId('delivery-phone').fill('+256700111222');
    for (const id of ['copy-phone', 'copy-location', 'copy-all']) {
      expect(Math.round((await sheet.getByTestId(id).boundingBox())!.height)).toBe(44);
    }
    await sheet.getByTestId('copy-phone').click();
    expect(await clip(page)).toBe('700111222');
    await sheet.getByTestId('copy-all').click();
    expect(await clip(page)).toBe(['Name: Nakato', 'Phone: 700111222'].join('\n'));
    // Edit the phone and copy again: it reads the field at tap time.
    await sheet.getByTestId('delivery-phone').fill('0755000111');
    await sheet.getByTestId('copy-phone').click();
    expect(await clip(page)).toBe('755000111');
  });

  test('an order sheet copies each line and Copy all, with no Collect for a paid order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const order = driver.mock.db.table('store_orders').find((r) => r.id === 'so-confirmed-1')!;
    order.phone_e164 = '+256700654321';
    // Store lines carry line_total and breakdown. The older seed shape only has a unit price.
    order.items = [{ product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { strawberry: 1 } }];
    await page.goto('/next/orders');
    await page.getByTestId('view-order-so-confirmed-1').click();
    const sheet = page.getByTestId('store-order-sheet');
    await sheet.waitFor();
    const base = ['Name: Test Buyer Two', 'Phone: 700654321', 'Drop-off: Kololo Test', `Map: ${MAP}`];
    await expect(sheet.getByTestId('so-phone-value')).toHaveText('+256700654321');
    await expect(sheet.getByTestId('so-place-value')).toHaveText('Kololo Test');
    await sheet.getByTestId('so-copy-phone').click();
    expect(await clip(page)).toBe('700654321');
    await sheet.getByTestId('so-copy-place').click();
    expect(await clip(page)).toBe(`Kololo Test\n${MAP}`);
    // A store order records no paid flag, so Copy all never asks the rider to collect.
    await sheet.getByTestId('so-copy-all').click();
    expect(await clip(page)).toBe(base.join('\n'));
  });

  test('a pickup order sheet has a phone, no drop-off, and Copy all without a location', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/next/orders');
    await page.getByTestId('view-order-seed-pending-order').click();
    const sheet = page.getByTestId('store-order-sheet');
    await sheet.waitFor();
    await expect(sheet).toHaveAttribute('data-mode', 'pickup');
    await expect(sheet.getByTestId('so-place')).toHaveCount(0);
    await sheet.getByTestId('so-copy-phone').click();
    expect(await clip(page)).toBe('700000099');
    await sheet.getByTestId('so-copy-all').click();
    expect(await clip(page)).not.toContain('Drop-off');
  });
});

test.describe('checkout lines and login', () => {
  test('a pack shows no ×1 and its joints as small text', async ({ page }) => {
    await createNextDriver(page, { role: 'pos_admin' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/next/sell');
    await page.getByTestId('product-pilot').click();
    await page.getByTestId('config-flavor-mint-inc').click();
    await page.getByTestId('config-flavor-grape-inc').click();
    await page.getByTestId('config-add').click();
    await page.getByRole('dialog', { name: 'Review sale' }).waitFor();
    await page.keyboard.press('Escape').catch(() => {});
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    const pilot = sheet.locator('.v-cart-line').first();
    // One pack is just one pack: no ×1 chip. A quantity only shows when it is more than one.
    await expect(pilot.getByTestId('line-qty')).toHaveCount(0);
    await expect(pilot.getByTestId('line-contents')).toHaveText('2 joints');
  });

  test('login uses the ink logo and v1 keeps its own', async ({ page }) => {
    await page.goto('/next/auth.html');
    const logo = page.locator('img.auth-logo');
    await expect(logo).toHaveAttribute('src', /assets\/logo-ink\.svg$/);
    const body = await (await page.request.get(await logo.evaluate((el) => (el as HTMLImageElement).src))).text();
    expect(body).toContain('#212121');
    expect(body).not.toContain('#059669');
  });
});
