import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createNextDriver } from './drivers/next';

const routes = ['/sell', '/system'];

test.describe('axe serious and critical', () => {
  for (const route of routes) {
    test(`${route} has no serious or critical violations`, async ({ page }) => {
      // Axe reads colour mid-fade if a page is still animating in. Measure the settled page.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const driver = await createNextDriver(page, { role: 'pos_admin' });
      await driver.run({
        id: 'axe',
        title: 'axe',
        role: 'pos_admin',
        seed: 'default',
        steps: [{ do: 'go', path: route }],
      });
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad, bad.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
    });
  }
});
