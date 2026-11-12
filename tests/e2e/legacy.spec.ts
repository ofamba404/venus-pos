import { test, expect } from '@playwright/test';
import { SCENARIOS } from './scenarios';
import { createLegacyDriver } from './drivers/legacy';

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
      await driver.run(scenario);
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
