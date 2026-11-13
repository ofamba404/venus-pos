import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';
import { installMockBackend } from '../mock';
import { pickOnWheels, setClock } from './helpers/clock';

const dir = process.env.V2C_SHOT_DIR || '/workspace/shots3';
const now = () => new Date().toISOString();

/** store_accounts rows shaped like store-auth admin_list_users returns them. Names and numbers are made up. */
const REAL_ACCOUNTS = [
  { id: 'ra-1', snapchat_name: 'Alpha One', pos_display_name: null, phone_country_code: '+256', phone_national: '700111222', verified: true, referral_code: 'AAAA' },
  { id: 'ra-2', snapchat_name: 'beta two', pos_display_name: 'Beta Alias', phone_country_code: '+256', phone_national: '', verified: false },
  { id: 'ra-3', snapchat_name: '_J_', pos_display_name: null, phone_country_code: '+256', phone_national: '', verified: true },
  { id: 'ra-4', snapchat_name: 'Alpha One', pos_display_name: null, phone_country_code: '+256', phone_national: '700111222', verified: true },
  { id: 'ra-5', snapchat_name: '', pos_display_name: null, phone_country_code: '+256', phone_national: '', verified: false },
  { id: 'ra-6', snapchat_name: 'Gamma Walks', pos_display_name: null, phone_country_code: '+256', phone_national: '', verified: true },
  { id: 'ra-7', snapchat_name: '-949-', pos_display_name: null, phone_country_code: '+256', phone_national: '', verified: false },
];

/** Accepted orders shaped like the live rows: product_id with underscores, store_product_id, a reward line at UGX 0. */
const ACCEPTED = [
  {
    id: 'real-acc-1', status: 'accepted', customer_name: 'Muza S', phone_e164: '+256700000001', created_at: now(), confirmed_at: now(),
    accepted_at: now(), sale_id: null, dismissed_at: null, delivery_enabled: true, delivery_fee_ugx: 5500, location_label: 'Ntinda',
    items: [
      { product_id: 'plain_single', store_product_id: 'plain-joint', product_name: 'Plain Joint', detail: 'Plain ×2', quantity: 2, line_total: 10000, breakdown: { classic: 2 }, stock_deferred: true },
    ],
  },
  {
    id: 'real-acc-2', status: 'accepted', customer_name: 'Bryan W', phone_e164: '+256700000002', created_at: now(), confirmed_at: now(),
    accepted_at: now(), sale_id: null, dismissed_at: null, delivery_enabled: true, delivery_fee_ugx: 7500, location_label: 'Kololo',
    items: [
      { product_id: 'pilot', store_product_id: 'pilot-pack', product_name: 'Pilot Pack', detail: 'Watermelon ×1, Blueberry ×1', quantity: 1, line_total: 15000, breakdown: { blueberry: 1, watermelon: 1 }, stock_deferred: true },
      { product_id: 'scout', store_product_id: 'scout-pack', product_name: 'Free Coconut Joint', detail: 'Coconut · Rewards redemption', quantity: 1, line_total: 0, breakdown: { coconut: 1 }, stock_deferred: true, is_reward: true, reward_key: 'free_flavored_joint', points_cost: 7500 },
    ],
  },
];

async function setup(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  mkdirSync(dir, { recursive: true });
}

test.describe('real-shaped data', () => {
  test('Clients: storefront accounts show their names and numbers, merge with walk-ins, and every chip filters', async ({ page }) => {
    await setup(page);
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    const accounts = driver.mock.db.table('store_accounts');
    accounts.splice(0, accounts.length, ...REAL_ACCOUNTS);
    const clients = driver.mock.db.table('clients');
    clients.length = 0;
    // The live clients table has no phone column.
    clients.push(
      { id: 'rc-1', name: 'Gamma Walks', created_at: now() },
      { id: 'rc-2', name: 'Delta Walkin', created_at: now() },
      { id: 'rc-3', name: '', created_at: now() },
    );
    await page.goto('/next/clients');
    await page.getByTestId('client-filters').waitFor();
    const rows = page.locator('[data-testid^="person-"]');
    await page.getByRole('tab', { name: /Storefront/ }).click();
    await expect(page.getByText('Alpha One')).toHaveCount(1);
    await expect(page.getByText('Beta Alias')).toBeVisible();
    await expect(page.getByText('+256700111222').first()).toBeVisible();
    await expect(page.getByText('_J_')).toBeVisible();
    await expect(page.getByText('-949-')).toBeVisible();
    // No blank "Client" rows from empty accounts.
    await expect(page.getByText(/^Client$/)).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/v2i-clients-storefront.png` });
    await page.getByRole('tab', { name: /Walk-in/ }).click();
    await expect(page.getByText('Delta Walkin')).toBeVisible();
    await expect(page.getByText('Gamma Walks')).toHaveCount(0); // joined to its storefront account
    await page.getByRole('tab', { name: /^All/ }).click();
    await expect(page.getByText('Gamma Walks')).toHaveCount(1);
    void rows;
  });

  test('Orders: Review sale rebuilds the cart from an accepted order after a reload, with Plain, Pilot and the free reward line', async ({ page }) => {
    await setup(page);
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.db.table('store_orders').push(...ACCEPTED);
    // A fresh phone session: no cart at all, but both orders are already Accepted on the server.
    await page.goto('/next/orders');
    await page.getByRole('tab', { name: /In sale/ }).click();
    await expect(page.getByTestId('load-order-real-acc-1')).toHaveText('Review sale');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2i-order-cards.png` });
    // Tight cards: each is far shorter than the old ~300px.
    const heights = await page.locator('article.order-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    for (const h of heights) expect(h).toBeLessThan(190);
    await page.getByTestId('load-order-real-acc-2').click();
    await page.waitForURL(/\/next\/sell/);
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('No items yet')).toHaveCount(0);
    await expect(sheet.locator('.v-cart-line')).toHaveCount(2);
    await expect(sheet).toContainText('Pilot Pack');
    await expect(sheet).toContainText('Free Coconut Joint');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/v2i-review-sale-loaded.png` });
    await sheet.getByRole('button', { name: 'Close' }).click();
    await sheet.waitFor({ state: 'hidden' });
    // Switching to the other accepted order rebuilds the cart from that order.
    await page.goto('/next/orders');
    await page.getByRole('tab', { name: /In sale/ }).click();
    await page.getByTestId('load-order-real-acc-1').click();
    const again = page.getByRole('dialog', { name: 'Review sale' });
    await expect(again.locator('.v-cart-line')).toHaveCount(1);
    await expect(again).toContainText('Plain Joint');
    await expect(again.getByTestId('line-qty')).toHaveText('×2');
  });

  test('Galleries: rounded-square contain tiles, dots below, the ×N badge off the photo, and the loop only moves forward', async ({ page }) => {
    await setup(page);
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    driver.mock.db.table('store_orders').push({
      ...ACCEPTED[1],
      id: 'real-gallery',
      status: 'confirmed',
      items: [
        { product_id: 'pilot', product_name: 'Pilot Pack', detail: 'x', quantity: 1, line_total: 15000, breakdown: { mint: 2, grape: 1 } },
        { product_id: 'cookie_duet', product_name: 'Cookie Duet', detail: 'x', quantity: 1, line_total: 15000, breakdown: { cookie_mint: 1, cookie_chocolate: 1 } },
      ],
    });
    await page.goto('/next/orders');
    const card = page.locator('article.order-card', { has: page.getByTestId('load-order-real-gallery') });
    const gallery = card.getByTestId('order-gallery');
    await gallery.waitFor();
    const viewport = gallery.locator('.v-gallery__viewport');
    const css = await viewport.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor };
    });
    expect(css.radius).not.toBe('0px');
    expect(parseFloat(css.radius)).toBeGreaterThanOrEqual(10);
    expect(css.bg).toBe('rgb(255, 255, 255)');
    expect(await gallery.locator('img').first().evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
    // Dots are in their own row below the tile.
    const box = await viewport.boundingBox();
    const dots = await gallery.locator('.v-gallery__dots').boundingBox();
    expect(dots!.y).toBeGreaterThanOrEqual(box!.y + box!.height - 1);
    // The ×2 badge is not inside the photo viewport, and it is whole (not clipped by it).
    await expect(viewport.locator('.v-gallery__qty')).toHaveCount(0);
    const qty = gallery.getByTestId('gallery-qty');
    await expect(qty).toHaveText('×2');
    const q = await qty.boundingBox();
    expect(q!.width).toBeGreaterThan(14);
    // Infinite: three real photos + clones. Past the last photo lands on a clone of the first, then rests on the real first.
    const track = gallery.getByTestId('gallery-track');
    const count = Number(await gallery.getAttribute('data-slides'));
    expect(count).toBe(4); // mint, grape, mint cookie, chocolate cookie
    const pos = () => track.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth));
    expect(await pos()).toBe(1);
    await track.evaluate((el, n) => el.scrollTo({ left: el.clientWidth * (n + 1), behavior: 'auto' }), count);
    await expect.poll(pos).toBe(1);
    await track.evaluate((el) => el.scrollTo({ left: 0, behavior: 'auto' }));
    await expect.poll(pos).toBe(count);
    await expect(gallery.locator('[data-gallery-clone="true"]')).toHaveCount(2);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${dir}/v2i-gallery.png` });
  });

  test('Hours: our own time picker (wheels, readout, Cancel and Set, keyboard) and Custom busy until a time, with the time left and a Clear', async ({ page }) => {
    await setup(page);
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/store');
    await page.getByTestId('hours-page').waitFor();
    await expect(page.locator('input[type="time"]')).toHaveCount(0);
    await page.getByTestId('hours-open').click();
    await page.getByTestId('clock-sheet').waitFor();
    await expect(page.locator('input[type="time"]')).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/v2i-hours-picker.png` });
    // Three wheels and a large readout.
    for (const w of ['clock-hour', 'clock-minute', 'clock-ampm']) await expect(page.getByTestId(`${w}-wheel`)).toBeVisible();
    await expect(page.getByTestId('clock-hour-12')).toBeVisible();
    await expect(page.getByTestId('clock-hour-13')).toHaveCount(0);
    // Keyboard: Down on the hour wheel moves to the next hour and the readout follows.
    const before = await page.getByTestId('clock-readout').innerText();
    await page.getByRole('radio', { name: /^8$/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('clock-readout')).not.toHaveText(before);
    // Cancel changes nothing.
    const chipBefore = await page.getByTestId('hours-open').innerText();
    await page.getByTestId('clock-cancel').click();
    await page.getByTestId('clock-sheet').waitFor({ state: 'hidden' });
    await expect(page.getByTestId('hours-open')).toHaveText(chipBefore);
    // Set applies.
    await setClock(page, 'hours-open', '09:45');
    await expect(page.getByTestId('hours-open')).toContainText(/9:45/);
    await setClock(page, 'hours-suggest-start', '13:30');
    await expect(page.getByTestId('hours-suggest-start')).toContainText(/(^|\D)(1|13):30/);

    // Custom busy: "until" a time on the same wheels. Two and a quarter hours from now, on a quarter-hour.
    const target = new Date(Date.now() + 135 * 60_000);
    target.setMinutes(Math.ceil(target.getMinutes() / 15) * 15, 0, 0);
    await page.getByTestId('busy-custom').click();
    await page.getByTestId('clock-sheet').waitFor();
    await pickOnWheels(page, `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`);
    const left = page.getByTestId('busy-remaining');
    await expect(left).toBeVisible();
    const body = driver.mock.writes.filter((w) => w.method === 'PATCH' && w.url.includes('store_fulfillment')).at(-1)!.body as { busy_until: string };
    expect(Math.abs(new Date(body.busy_until).getTime() - target.getTime())).toBeLessThan(2 * 60_000);
    await page.screenshot({ path: `${dir}/v2i-hours-busy-custom.png` });
    await page.getByTestId('busy-clear').click();
    await expect(page.getByTestId('busy-active')).toHaveCount(0);
  });

  test('Cookie partner: a sent batch loads into the top card (shot)', async ({ page }) => {
    await setup(page);
    const cuts = [...Array.from({ length: 10 }, () => 25), 12];
    await installMockBackend(page, { role: 'pos_admin', partnerSettle: { qty: 262, batches: cuts } });
    await page.goto('/next/cookie-partner');
    await page.getByTestId('partner-history').waitFor();
    await page.getByTestId('partner-history-more').click();
    await page.getByTestId('partner-batch-toggle-11').click();
    await expect(page.getByTestId('partner-hero')).toHaveAttribute('data-viewing', '11');
    await expect(page.getByTestId('partner-open-count')).toHaveText('12');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${dir}/v2i-cookie-partner-batch-loaded.png` });
  });

  for (const width of [390, 360]) {
    test(`History: the money column stays tidy at ${width}px (owes on one line, Credit pill whole)`, async ({ page }) => {
      await setup(page, width);
      await createNextDriver(page, { role: 'pos_admin' });
      await page.goto('/next/history');
      await page.getByRole('tab', { name: 'Credit' }).click();
      const owed = page.locator('[data-testid^="history-owed-"]').first();
      await owed.waitFor();
      const row = page.locator('.history-row', { has: owed }).first();
      const label = await owed.locator('.history-owed__label').boundingBox();
      const money = await owed.locator('.v-money').boundingBox();
      expect(Math.abs((label!.y + label!.height / 2) - (money!.y + money!.height / 2))).toBeLessThan(8);
      const pill = await row.locator('.v-tag').last().boundingBox();
      const r = await row.boundingBox();
      expect(pill!.x + pill!.width).toBeLessThanOrEqual(r!.x + r!.width + 0.5);
      expect(pill!.x).toBeGreaterThanOrEqual(r!.x);
      if (width === 390) {
        await row.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${dir}/v2i-history-credit.png` });
      }
    });
  }
});
