import type { Page } from '@playwright/test';

const KEY = 'venus.pos.helper-since.v1';

/**
 * With no Helper started day there is no helper at all. Tests that look at the helper's share start one
 * (long ago, so every seeded sale counts) before the page loads.
 */
export async function withHelper(page: Page, day = '2000-01-01') {
  await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [KEY, day]);
}
