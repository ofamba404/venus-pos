import { test, expect } from '@playwright/test';
import {
  S01,
  S02,
  S03,
  S04,
  S05,
  S06,
  S07,
  S08,
  S09,
  S10,
  S11,
  S12,
  S13,
  S14,
  S15,
  S16,
  S17,
  S18,
  S19,
  S20,
  S21,
  S22,
  S23,
  S24,
  S25,
  S26,
  S27,
  S28,
  S29,
  S30,
  S31,
  S32,
  S33,
  S34,
  S35,
  S36,
  S37,
  S38,
  S39,
  S40,
  S41,
  S42,
  S43,
  S44,
  S45,
  S46,
  S47,
  S48,
  S49,
  S50,
  SCENARIOS,
} from './scenarios';
import { createNextDriver } from './drivers/next';
import { assertCausalOrder, normalizeWrites } from './goldens/normalize';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

function saleTotal(driver: Awaited<ReturnType<typeof createNextDriver>>) {
  const salePosts = driver.mock.writes.filter(
    (w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'),
  );
  expect(salePosts.length).toBeGreaterThanOrEqual(1);
  return {
    posts: salePosts,
    total: Number((salePosts[0]!.body as { total_ugx?: number }).total_ugx),
  };
}

test.describe('write-contract scenarios (next)', () => {
  test('scenario catalog has S01–S50', () => {
    expect(SCENARIOS).toHaveLength(50);
    expect(SCENARIOS.map((s) => s.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`),
    );
  });

  test('S01 Scout pack paid', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S01);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    await expect
      .poll(() =>
        driver.mock.writes.some(
          (w) =>
            (w.body as { op?: string; category_id?: string })?.op === 'delta' &&
            (w.body as { category_id?: string }).category_id === 'mint',
        ),
      )
      .toBe(true);
    const normalized = normalizeWrites(
      driver.mock.writes.filter((w) => w.method !== 'GET' && w.method !== 'HEAD'),
    );
    assertCausalOrder(normalized);
    if (process.env.RECORD === '1') {
      const dir = path.resolve('tests/e2e/goldens');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'S01.next.json'),
        JSON.stringify({ id: 'S01', total_ugx: total, writes: normalized, sample: posts[0]?.body }, null, 2),
      );
    }
  });

  test('S02 Cookie Duet paid', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S02);
    expect(saleTotal(driver).total).toBe(15000);
  });

  test('S03 Cookie Quartet paid', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S03);
    expect(saleTotal(driver).total).toBe(25000);
  });

  test('S04 four flavoured singles bulk', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S04);
    expect(saleTotal(driver).total).toBe(26000);
  });

  test('S05 Cookie Trio plus singles bulk', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S05);
    expect(saleTotal(driver).total).toBe(32500);
  });

  test('S06 wholesale cookies at a custom unit price', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S06);
    expect(saleTotal(driver).total).toBe(25000);
  });

  test('S07 Plain × 3', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S07);
    expect(saleTotal(driver).total).toBe(15000);
  });

  test('S08 Bangis mix', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S08);
    expect(saleTotal(driver).total).toBe(15000);
  });

  test('S10 new client inline', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S10);
    expect(saleTotal(driver).total).toBe(8000);
    const clientPosts = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/clients'),
    );
    expect(clientPosts.length).toBeGreaterThanOrEqual(1);
  });

  test('S09 Variety plus Commander', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S09);
    expect(saleTotal(driver).total).toBe(85000);
  });

  test('S11 credit sale', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S11);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    expect((posts[0]!.body as { is_credit?: boolean }).is_credit).toBe(true);
    expect((posts[0]!.body as { amount_paid_ugx?: number }).amount_paid_ugx).toBe(0);
  });

  test('S12 stacked credit accepted', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S12);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    expect((posts[0]!.body as { is_credit?: boolean }).is_credit).toBe(true);
  });

  test('S13 stacked credit declined', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S13);
    const salePosts = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'),
    );
    expect(salePosts).toHaveLength(0);
  });

  test('S14 delivery with phone and deliver-at', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S14);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    const body = posts[0]!.body as {
      client_phone?: string;
      location_label?: string;
      delivery?: { deliverAt?: string };
      delivery_enabled?: boolean;
    };
    expect(body.client_phone).toBe('+256700000001');
    expect(body.delivery?.deliverAt).toBe('2026-11-12T15:00:00+03:00');
    expect(String(body.location_label || '')).toMatch(/Kololo/i);
    expect(body.delivery_enabled).toBe(true);
    const trips = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/deliveries'),
    );
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect((trips[0]!.body as { fee_was_edited?: boolean }).fee_was_edited).toBe(false);
  });

  test('S15 delivery fee edited by hand', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S15);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    const body = posts[0]!.body as { delivery_fee_ugx?: number; location_label?: string };
    expect(body.delivery_fee_ugx).toBe(7000);
    expect(String(body.location_label || '')).toMatch(/Ntinda/i);
    const trips = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/deliveries'),
    );
    expect((trips[0]!.body as { fee_was_edited?: boolean }).fee_was_edited).toBe(true);
  });

  test('S16 edit a line before charge', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S16);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    const items = (posts[0]!.body as { items?: Array<{ breakdown?: Record<string, number> }> }).items || [];
    expect(items[0]?.breakdown?.strawberry).toBe(1);
    expect(items[0]?.breakdown?.mint || 0).toBe(0);
  });

  test('S18 sales post fails once then retry', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S18);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    expect(posts).toHaveLength(1);
  });

  test('S20 reward line checks out at the paid total', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S20);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    const items = (posts[0]!.body as {
      items?: Array<{ is_reward?: boolean; reward_key?: string; points_cost?: number; line_total?: number }>;
    }).items || [];
    const reward = items.find((item) => item.is_reward);
    expect(reward?.reward_key).toBe('plain');
    expect(reward?.points_cost).toBe(1);
    expect(reward?.line_total).toBe(0);
  });

  test('S21 load and confirm a pending order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S21);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    expect((posts[0]!.body as { store_order_id?: string }).store_order_id).toBe('seed-pending-order');
    const statuses = driver.mock.writes
      .filter((w) => w.method === 'PATCH' && w.url.includes('/rest/v1/store_orders'))
      .map((w) => (w.body as { status?: string } | null)?.status);
    expect(statuses).toContain('accepted');
    expect(statuses).toContain('confirmed');
    expect(statuses).toContain('checked_out');
  });

  test('S22 cancel a pending order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S22);
  });

  test('S23 dismiss a cancelled order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S23);
  });

  test('S24 check out the second loaded order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S24);
    expect(saleTotal(driver).total).toBe(15000);
  });

  test('S25 restore the parked counter cart', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S25);
    expect(saleTotal(driver).total).toBe(8000);
  });

  test('S27 deep link opens the store order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S27);
  });

  test('S34 settle part of a credit balance', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S34);
    const payments = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/credit_payments'),
    );
    expect(payments.length).toBeGreaterThanOrEqual(1);
    expect((payments[0]!.body as { amount_ugx?: number; method?: string }).amount_ugx).toBe(5000);
    expect((payments[0]!.body as { method?: string }).method).toBe('cash');
  });

  test('S35 settle the rest of a credit balance', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S35);
    const payments = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/credit_payments'),
    );
    expect((payments[0]!.body as { method?: string; note?: string }).method).toBe('mobile_money');
    expect((payments[0]!.body as { note?: string }).note).toBe('Cleared at counter');
  });

  test('S47 admin routes render', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S47);
  });

  test('S26 a new order toasts on Sell', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S26);
  });

  test('S28 busy thirty minutes then clear', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S28);
    const patches = driver.mock.writes.filter(
      (w) => w.method === 'PATCH' && w.url.includes('/rest/v1/store_fulfillment'),
    );
    expect(patches.length).toBeGreaterThanOrEqual(2);
  });

  test('S31 bulk add 24 to strawberry', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S31);
  });

  test('S32 inventory write falls back to a patch', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S32);
    const patches = driver.mock.writes.filter(
      (w) => w.method === 'PATCH' && w.url.includes('/rest/v1/inventory'),
    );
    expect(patches.length).toBeGreaterThanOrEqual(1);
    expect((patches[0]!.body as { stock?: number }).stock).toBe(21);
  });

  test('S33 low-stock toast after a sale', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S33);
  });

  test('S36 edit a past sale and adjust stock', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S36);
    const patches = driver.mock.writes.filter(
      (w) => w.method === 'PATCH' && w.url.includes('/rest/v1/sales') && w.url.includes('seed-sale-1'),
    );
    expect(patches.length).toBeGreaterThanOrEqual(1);
    const body = patches.at(-1)!.body as {
      total_ugx?: number;
      items?: Array<{ breakdown?: { mint?: number } }>;
    };
    expect(body.total_ugx).toBe(16000);
    expect(body.items?.[0]?.breakdown?.mint).toBe(2);
    const deltas = driver.mock.writes.filter(
      (w) =>
        (w.body as { op?: string } | null)?.op === 'delta' &&
        (w.body as { category_id?: string } | null)?.category_id === 'mint' &&
        (w.body as { delta?: number } | null)?.delta === -1,
    );
    expect(deltas.length).toBeGreaterThanOrEqual(1);
  });

  test('S37 void a delivery sale and return stock', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S37);
    const deleted = driver.mock.writes.filter(
      (w) => w.method === 'DELETE' && w.url.includes('/rest/v1/sales') && w.url.includes('seed-delivery-sale'),
    );
    expect(deleted.length).toBeGreaterThanOrEqual(1);
    const returned = driver.mock.writes.filter(
      (w) =>
        (w.body as { op?: string } | null)?.op === 'delta' &&
        (w.body as { category_id?: string } | null)?.category_id === 'mint' &&
        (w.body as { delta?: number } | null)?.delta === 1,
    );
    expect(returned.length).toBeGreaterThanOrEqual(1);
    const trip = driver.mock.db.table('deliveries').find((row) => row.sale_id === 'seed-delivery-sale');
    expect(trip).toBeUndefined();
  });

  test('S38 partner batch copies cookie text', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S38);
    const settle = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/api/cookie-partner/settle'),
    );
    expect(settle.length).toBeGreaterThanOrEqual(1);
    expect(Number((settle[0]!.body as { settled_qty?: number }).settled_qty)).toBeGreaterThan(25);
  });

  test('S42 edit a delivery trip fee', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S42);
    const patches = driver.mock.writes.filter(
      (w) => w.method === 'PATCH' && w.url.includes('/rest/v1/deliveries') && w.url.includes('seed-trip-1'),
    );
    expect(patches.length).toBeGreaterThanOrEqual(1);
    expect((patches.at(-1)!.body as { fee_ugx?: number }).fee_ugx).toBe(9000);
  });

  test('S49 sign out then sign in respects next', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S49);
    const tokens = driver.mock.requests.filter((r) => r.method === 'POST' && r.url.includes('/auth/v1/token'));
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  test('S50 today, credit, and history match the seed', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S50);
  });

  test('inventory 405 falls back to a patch', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/stock');
    await page.getByTestId('stock-mint-qty').filter({ hasText: '20' }).waitFor({ timeout: 15000 });
    driver.mock.setFailure({
      method: 'POST',
      pathIncludes: '/api/inventory/write',
      bodyOp: 'delta',
      status: 405,
      times: 1,
    });
    await page.getByTestId('stock-mint-inc').click();
    const patches = () =>
      driver.mock.writes.filter(
        (w) =>
          w.method === 'PATCH' &&
          w.url.includes('/rest/v1/inventory') &&
          (w.body as { stock?: number } | null)?.stock === 21,
      );
    await expect.poll(() => patches().length, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
    await page.getByTestId('stock-mint-qty').filter({ hasText: '21' }).waitFor({ timeout: 8000 });
  });

  test('a new review toasts on the reviews page', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await page.goto('/next/reviews');
    await page.getByTestId('review-count').filter({ hasText: '2' }).waitFor({ timeout: 8000 });
    await expect.poll(() => driver.mock.realtimeClients, { timeout: 8000 }).toBeGreaterThan(0);
    driver.mock.db.table('store_reviews').unshift({
      id: 'arrived-review',
      created_at: '2026-11-10T08:00:00.000Z',
      rating: 5,
      body: 'Just arrived',
      customer_name: 'Live',
    });
    driver.mock.notifyRealtime();
    await page.getByRole('status').filter({ hasText: /new review/i }).waitFor({ timeout: 8000 });
  });

  test('GPS locate keeps the latest fix', async ({ page }) => {
    await page.addInitScript(() => {
      let calls = 0;
      const geo = {
        getCurrentPosition(success: (pos: { coords: { latitude: number; longitude: number } }) => void) {
          calls += 1;
          const n = calls;
          window.setTimeout(() => {
            success({ coords: { latitude: n === 1 ? 0.11 : 0.22, longitude: 32.58 } });
          }, n === 1 ? 600 : 40);
        },
      };
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
    });
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run({
      id: 'GPS',
      title: 'gps',
      role: 'pos_staff',
      seed: 'default',
      steps: [{ do: 'addProduct', product: 'scout', flavors: { mint: 1 } }],
    });
    const dialog = page.getByRole('dialog', { name: 'Review sale' });
    const opened = await dialog.isVisible().catch(() => false);
    const scope = opened ? dialog : page.locator('[data-desktop-cart]');
    const button = scope.getByTestId('pickup-locate');
    await button.click();
    await button.click();
    await expect(scope.getByTestId('pickup-label')).toHaveText('0.22, 32.58', { timeout: 4000 });
  });

  test('S39 add rename and delete a client', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S39);
  });

  test('S40 rename verify and delete a store user', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S40);
  });

  test('S41 save store hours', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S41);
  });

  test('S43 quote lab logs a preset', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S43);
  });

  test('S44 reviews list at least one', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_admin' });
    await driver.run(S44);
  });

  test('S45 enable notification prefs', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S45);
  });

  test('S46 staff insights redirects to sell', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S46);
  });

  test('S48 offline charge queues', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S48);
  });

  test('S17 remove line then undo then remove', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S17);
    expect(saleTotal(driver).total).toBe(8000);
  });

  test('S19 double-tap charge is one sale', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S19);
    const { total, posts } = saleTotal(driver);
    expect(total).toBe(8000);
    expect(posts).toHaveLength(1);
  });

  test('S29 stock plus and minus returns to the seeded count', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S29);
  });

  test('S30 set stock count', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S30);
    const deltas = driver.mock.writes.filter(
      (w) =>
        String((w.body as { op?: string })?.op || '') === 'delta' &&
        String((w.body as { category_id?: string })?.category_id || '') === 'mint',
    );
    expect(deltas.length).toBeGreaterThanOrEqual(1);
  });
});
