import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCENARIOS } from './scenarios';
import { createLegacyDriver } from './drivers/legacy';
import { assertCausalOrder, normalizeWrites } from './goldens/normalize';
import { installMockBackend } from '../mock';

function salePosts(driver: Awaited<ReturnType<typeof createLegacyDriver>>) {
  return driver.mock.writes.filter((w) => w.method === 'POST' && w.url.includes('/rest/v1/sales'));
}

test.describe('legacy register driver', () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.id} ${scenario.title}`, async ({ page }) => {
      const driver = await createLegacyDriver(page, {
        role: scenario.role,
        seed: scenario.seed,
      });
      if (scenario.id === 'S03') {
        await driver.run({ ...scenario, steps: [{ do: 'go', path: '/' }] });
        await expect(page.locator('[data-product="cookie_quartet"]')).toHaveCount(0);
        return;
      }
      await driver.run(scenario);
      const writes = normalizeWrites(
        driver.mock.writes.filter((w) => w.method !== 'GET' && w.method !== 'HEAD'),
      ).filter((w) => !String(w.path).includes('pos_staff_directory'));
      const file = path.join('tests/e2e/goldens', `${scenario.id}.json`);
      if (process.env.RECORD === '1') {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify({ id: scenario.id, writes }, null, 2)}\n`);
      } else if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as { writes: Array<{ path?: string }> };
        const savedWrites = saved.writes.filter((w) => !String(w.path).includes('pos_staff_directory'));
        expect(writes).toEqual(savedWrites);
      }
      assertCausalOrder(writes);
      if (scenario.id === 'S11') {
        expect(salePosts(driver).length).toBeGreaterThanOrEqual(1);
        expect((salePosts(driver)[0]!.body as { is_credit?: boolean }).is_credit).toBe(true);
      }
      if (scenario.id === 'S19') {
        expect(salePosts(driver)).toHaveLength(2);
      }
    });
  }
});

const LEGACY_SCREENS = [
  { name: 'legacy-inventory', url: '/pages/inventory.html', ready: '#invGrid .count' },
  { name: 'legacy-clients', url: '/pages/clients.html', ready: '#newClientInput' },
  { name: 'legacy-history', url: '/pages/history.html', ready: '[data-edit-sale]' },
  { name: 'legacy-analytics', url: '/pages/analytics.html', ready: '.credit-client-group' },
  { name: 'legacy-delivery', url: '/pages/delivery.html', ready: '#quoteLabChips' },
  { name: 'legacy-reviews', url: '/pages/reviews.html', ready: '#reviewsList' },
  { name: 'legacy-admin', url: '/pages/admin.html', ready: '[data-admin-tab]' },
  { name: 'legacy-auth', url: '/auth.html', ready: '#login-email' },
];

test('legacy screens at four viewports', async ({ page }) => {
  test.skip(!process.env.CAPTURE, 'set CAPTURE=1 to refresh docs/overhaul/baseline');
  test.setTimeout(180_000);
  const dir = 'docs/overhaul/baseline';
  mkdirSync(dir, { recursive: true });
  await installMockBackend(page, { role: 'pos_admin' });
  const viewports = [
    [360, 740],
    [390, 844],
    [768, 1024],
    [1280, 800],
  ] as const;
  for (const screen of LEGACY_SCREENS) {
    if (screen.name === 'legacy-auth') {
      await page.evaluate(() => {
        sessionStorage.setItem('venus-signed-out', '1');
        localStorage.removeItem('venus-pos-auth');
      });
    }
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.goto(screen.url);
      await page.locator(screen.ready).first().waitFor({ state: 'attached', timeout: 20000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/${screen.name}-${width}x${height}.png` });
    }
  }
});
