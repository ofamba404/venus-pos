import { test, expect } from '@playwright/test';
import { S01, S02, S07, S29, S30, SCENARIOS } from './scenarios';
import { createNextDriver } from './drivers/next';

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
    const salePosts = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'),
    );
    expect(salePosts.length).toBeGreaterThanOrEqual(1);
    const body = salePosts[0]!.body as { total_ugx?: number };
    expect(body.total_ugx).toBe(8000);
  });

  test('S02 Cookie Duet paid', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S02);
    const salePosts = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'),
    );
    expect(salePosts.length).toBeGreaterThanOrEqual(1);
    const body = salePosts[0]!.body as { total_ugx?: number };
    expect(body.total_ugx).toBe(15000);
  });

  test('S07 Plain × 3', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await driver.run(S07);
    const salePosts = driver.mock.writes.filter(
      (w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'),
    );
    expect(salePosts.length).toBeGreaterThanOrEqual(1);
    const body = salePosts[0]!.body as { total_ugx?: number };
    expect(body.total_ugx).toBe(15000);
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
