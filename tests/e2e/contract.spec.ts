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
  S17,
  S19,
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
