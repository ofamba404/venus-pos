import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNextDriver } from './drivers/next';

/**
 * Checkout speed with 300ms of simulated latency on every API call. Each test records how long the tap takes to
 * show "Sale recorded", and which API calls happened before that (the serial path the cashier waits on) and
 * after it (background work). Set SPEED_LABEL to write /workspace/speed-<label>.json. SPEED_BUDGET=0 reports only.
 */
const LATENCY = 300;
const LABEL = process.env.SPEED_LABEL || '';
const BUDGET = process.env.SPEED_BUDGET !== '0';
const report: Record<string, unknown> = {};

const api = (u: string) => /\/rest\/v1\/|\/api\/|\/functions\/v1\//.test(u) && !/\/realtime\//.test(u);
const short = (r: { method: string; url: string }) => {
  const url = new URL(r.url);
  const body = url.pathname.replace('/rest/v1/', '').replace('/api/', '');
  return `${r.method} ${body}${url.pathname.includes('reserve') || url.pathname.includes('inventory/write') ? '' : ''}`;
};

async function measure(page: Page, mock: Awaited<ReturnType<typeof createNextDriver>>['mock'], click: () => Promise<void>) {
  await page.waitForTimeout(1500);
  mock.setLatency(LATENCY);
  const from = mock.requests.length;
  // Time it inside the page: Playwright's own polling adds up to half a second of noise to a wait.
  await page.evaluate(() => {
    const w = window as unknown as { __t0: number; __shown?: number };
    w.__t0 = performance.now();
    w.__shown = undefined;
    const check = () => {
      if (w.__shown == null && /Sale recorded|Recorded on credit/.test(document.body.innerText)) w.__shown = performance.now() - w.__t0;
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await click();
  await page.waitForFunction(() => (window as unknown as { __shown?: number }).__shown != null, undefined, { timeout: 15000 });
  const ms = Math.round(await page.evaluate(() => (window as unknown as { __shown: number }).__shown));
  const during = mock.requests.slice(from).filter((r) => api(r.url)).map(short);
  await page.waitForTimeout(2500);
  const total = mock.requests.slice(from).filter((r) => api(r.url)).map(short);
  mock.setLatency(0);
  return { ms, before: during, background: total.slice(during.length), serialCalls: during.length };
}

test.describe('checkout speed @ 300ms per request', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });
  test.afterAll(() => {
    if (LABEL) writeFileSync(`/workspace/speed-${LABEL}.json`, JSON.stringify(report, null, 2));
  });

  async function walkIn(page: Page, client: string) {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/sell');
    await page.getByTestId('product-plain_single').click();
    await page.getByTestId('config-add').click();
    const sheet = page.getByRole('dialog', { name: 'Review sale' });
    await sheet.getByTestId('cart-client').fill(client);
    const result = await measure(page, driver.mock, () => sheet.getByTestId('charge').click());
    return result;
  }

  test('walk-in sale, existing client', async ({ page }) => {
    const r = await walkIn(page, 'Test Client A');
    report.walkInExisting = r;
    if (BUDGET) expect(r.ms).toBeLessThan(LATENCY * 2 + 400);
  });

  test('walk-in sale, new client', async ({ page }) => {
    const r = await walkIn(page, 'Brand New Person');
    report.walkInNewClient = r;
    if (BUDGET) expect(r.ms).toBeLessThan(LATENCY * 2 + 400);
  });

  test('store order: opening the sheet is instant, checkout is the essential write only', async ({ page }) => {
    const driver = await createNextDriver(page, { role: 'pos_staff' });
    await page.goto('/next/orders');
    await page.getByTestId('view-order-seed-pending-order').waitFor();
    await page.waitForTimeout(1500);
    driver.mock.setLatency(LATENCY);
    const from = driver.mock.requests.length;
    const t0 = Date.now();
    await page.getByTestId('view-order-seed-pending-order').click();
    await page.getByTestId('store-order-sheet').waitFor();
    const openMs = Date.now() - t0;
    const openCalls = driver.mock.requests.slice(from).filter((r) => api(r.url)).map(short);
    driver.mock.setLatency(0);
    report.storeOrderOpen = { ms: openMs, calls: openCalls };
    if (BUDGET) expect(openMs).toBeLessThan(300);

    const r = await measure(page, driver.mock, () => page.getByTestId('store-order-checkout').click());
    report.storeOrderCheckout = r;
    if (BUDGET) expect(r.ms).toBeLessThan(LATENCY * 2 + 400);
  });
});
