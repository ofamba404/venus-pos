import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installMockBackend } from '../mock';

/**
 * Phase 0 capture. These files are a before/after record, not a visual assertion.
 * D11 approved the current look on 2026-11-12.
 * Timings go to perf-latest.md so this run does not erase the notes in perf.md.
 */
test('capture sell, stock, and legacy home', async ({ page }) => {
  test.setTimeout(180_000);
  const dir = 'docs/overhaul/baseline';
  mkdirSync(dir, { recursive: true });
  await installMockBackend(page, { role: 'pos_staff', seed: 'default' });

  const rows: string[] = [];

  async function shot(name: string, url: string, width: number, height: number, ready: string) {
    await page.setViewportSize({ width, height });
    const start = Date.now();
    await page.goto(url);
    await page.locator(ready).first().waitFor({ timeout: 20_000 });
    const ms = Date.now() - start;
    await page.screenshot({ path: `${dir}/${name}.png` });
    rows.push(`| ${name} | ${width}×${height} | ${ms} |`);
  }

  await shot('next-sell-360x740', '/next/sell', 360, 740, '[data-testid="product-scout"]');
  await shot('next-sell-390x844', '/next/sell', 390, 844, '[data-testid="product-scout"]');
  await shot('next-sell-768x1024', '/next/sell', 768, 1024, '[data-testid="product-scout"]');
  await shot('next-sell-1280x800', '/next/sell', 1280, 800, '[data-testid="product-scout"]');
  await shot('next-stock-360x740', '/next/stock', 360, 740, '[data-testid="stock-mint-qty"]');
  await shot('next-stock-390x844', '/next/stock', 390, 844, '[data-testid="stock-mint-qty"]');
  await shot('next-stock-768x1024', '/next/stock', 768, 1024, '[data-testid="stock-mint-qty"]');
  await shot('next-stock-1280x800', '/next/stock', 1280, 800, '[data-testid="stock-mint-qty"]');
  await shot('legacy-home-360x740', 'http://127.0.0.1:4173/', 360, 740, '[data-product="plain_single"]');
  await shot('legacy-home-390x844', 'http://127.0.0.1:4173/', 390, 844, '[data-product="plain_single"]');
  await shot('legacy-home-768x1024', 'http://127.0.0.1:4173/', 768, 1024, '[data-product="plain_single"]');
  await shot('legacy-home-1280x800', 'http://127.0.0.1:4173/', 1280, 800, '[data-product="plain_single"]');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await shot('next-sell-390x844-throttled', '/next/sell', 390, 844, '[data-testid="product-scout"]');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  writeFileSync(
    `${dir}/perf-latest.md`,
    `# Baseline timings (latest capture)

Local Playwright, mock backend. Unthrottled rows are not the budget in \`04-architecture.md\` §9. The throttled row uses a Fast 4G approximation (150 ms latency, 1.6 Mbps down, 750 kbps up) and 4× CPU. It is one sample on the mock, not a pass against the 2.0 s cold-start budget. D11 approved the current look on 2026-11-12. Legacy home at 1280 still crops the product grid below the first screen. This file is the latest capture only. The kept record is perf.md.

| Capture | Viewport | Ready (ms) |
| --- | --- | ---: |
${rows.join('\n')}

Ready means the first sell tile, stock quantity, or legacy product row was visible after navigation.
`,
  );
});
