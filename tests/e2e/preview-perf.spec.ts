import { test } from '@playwright/test';
import { installMockBackend } from '../mock';

test.skip(!process.env.PREVIEW_PERF, 'set PREVIEW_PERF=1 against a static dist server');

test('throttled production sell ready', async ({ page, context }) => {
  await installMockBackend(page, { role: 'pos_staff' });
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const start = Date.now();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/next/sell');
  await page.getByTestId('product-scout').waitFor({ timeout: 30000 });
  const ms = Date.now() - start;
  console.log(`PREVIEW_READY_MS ${ms}`);
});
