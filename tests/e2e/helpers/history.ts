import type { Page } from '@playwright/test';

/** Open every collapsed week and day heading in History until the sale row is on screen. */
export async function revealSale(page: Page, id: string) {
  const row = page.getByTestId(`history-sale-${id}`);
  // The list loads after the page does.
  await page.locator('[data-testid^="history-day-toggle-"], [data-testid^="history-week-toggle-"]').first().waitFor();
  for (let i = 0; i < 60; i += 1) {
    if (await row.first().isVisible().catch(() => false)) return row.first();
    const closed = page.locator('[data-testid^="history-week-toggle-"][aria-expanded="false"], [data-testid^="history-day-toggle-"][aria-expanded="false"]');
    if (!(await closed.count())) break;
    await closed.first().click();
    await page.waitForTimeout(60);
  }
  await row.first().waitFor();
  return row.first();
}

/** Reveal a sale in History, then tap it. */
export async function openSale(page: Page, id: string) {
  const row = await revealSale(page, id);
  await row.click();
}
