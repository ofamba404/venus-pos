import { test, expect } from '@playwright/test';
import { S01, S02, S03, S04, S05, S07, S08, S11, S19 } from './scenarios';
import { createLegacyDriver } from './drivers/legacy';
import { buildDefaultSeed } from '../fixtures/seed';
import { computeTodayStats } from '../../src/domain/today';

function saleTotal(driver: Awaited<ReturnType<typeof createLegacyDriver>>) {
  const salePosts = driver.mock.writes.filter(
    (w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'),
  );
  expect(salePosts.length).toBeGreaterThanOrEqual(1);
  return Number((salePosts[0]!.body as { total_ugx?: number }).total_ugx);
}

function salePosts(driver: Awaited<ReturnType<typeof createLegacyDriver>>) {
  return driver.mock.writes.filter((w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'));
}

test.describe('legacy register driver', () => {
  test('S01 Scout pack paid', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S01);
    expect(saleTotal(driver)).toBe(8000);
  });

  test('S07 Plain × 3', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S07);
    expect(saleTotal(driver)).toBe(15000);
  });

  test('S02 Cookie Duet paid', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S02);
    expect(saleTotal(driver)).toBe(15000);
  });

  test('S05 Cookie Trio plus singles bulk', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S05);
    expect(saleTotal(driver)).toBe(32500);
  });

  test('S03 Cookie Quartet paid', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S03);
    expect(saleTotal(driver)).toBe(25000);
  });

  test('S04 four flavoured singles', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S04);
    expect(saleTotal(driver)).toBe(26000);
  });

  test('S08 Bangis mix', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S08);
    expect(saleTotal(driver)).toBe(15000);
  });

  test('S11 credit sale', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S11);
    const posts = salePosts(driver);
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(Number((posts[0]!.body as { total_ugx?: number }).total_ugx)).toBe(8000);
    expect((posts[0]!.body as { is_credit?: boolean }).is_credit).toBe(true);
  });

  test('S19 double-tap charge is one sale', async ({ page }) => {
    const driver = await createLegacyDriver(page, { role: 'pos_staff' });
    await driver.run(S19);
    expect(salePosts(driver)).toHaveLength(1);
  });

  test('S50 today revenue matches the seed clock', async ({ page }) => {
    await createLegacyDriver(page, { role: 'pos_admin' });
    await page.goto('/');
    const el = page.locator('#todayRevenue');
    await expect
      .poll(async () => ((await el.textContent()) || '').trim(), { timeout: 15000 })
      .not.toMatch(/—/);
    const shown = Number(((await el.textContent()) || '').replace(/[^\d]/g, ''));
    const joints = Number(((await page.locator('#todayJoints').textContent()) || '').replace(/[^\d-]/g, ''));
    const cookies = Number(((await page.locator('#todayCookies').textContent()) || '').replace(/[^\d-]/g, ''));
    const expected = computeTodayStats(
      buildDefaultSeed().sales as Parameters<typeof computeTodayStats>[0],
    );
    expect(shown).toBe(expected.revenue);
    expect(joints).toBe(expected.joints);
    expect(cookies).toBe(expected.cookies);
  });
});
