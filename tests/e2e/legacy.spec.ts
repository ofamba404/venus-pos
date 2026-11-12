import { test, expect } from '@playwright/test';
import { S02, S05, S07 } from './scenarios';
import { createLegacyDriver } from './drivers/legacy';

function saleTotal(driver: Awaited<ReturnType<typeof createLegacyDriver>>) {
  const salePosts = driver.mock.writes.filter(
    (w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'),
  );
  expect(salePosts.length).toBeGreaterThanOrEqual(1);
  return Number((salePosts[0]!.body as { total_ugx?: number }).total_ugx);
}

test.describe('legacy register driver', () => {
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
});
