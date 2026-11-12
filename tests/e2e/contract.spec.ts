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
  S27,
  S29,
  S30,
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
    expect(saleTotal(driver).total).toBe(8000);
  });

  test('S21 load and confirm a pending order', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S21);
    expect(saleTotal(driver).total).toBe(8000);
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
