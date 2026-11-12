import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installMockBackend } from '../mock';

/**
 * Phase 0 capture. These files are a before/after record, not a visual assertion.
 * D11 look approval is still the owner's.
 */
test('capture sell, stock, and legacy home', async ({ page }) => {
  test.setTimeout(120_000);
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

  await shot('next-sell-390x844', '/next/sell', 390, 844, '[data-testid="product-scout"]');
  await shot('next-sell-1280x800', '/next/sell', 1280, 800, '[data-testid="product-scout"]');
  await shot('next-stock-390x844', '/next/stock', 390, 844, '[data-testid="stock-mint-qty"]');
  await shot('next-stock-1280x800', '/next/stock', 1280, 800, '[data-testid="stock-mint-qty"]');
  await shot('legacy-home-390x844', 'http://127.0.0.1:4173/', 390, 844, '[data-product="plain_single"]');
  await shot('legacy-home-1280x800', 'http://127.0.0.1:4173/', 1280, 800, '[data-product="plain_single"]');

  writeFileSync(
    `${dir}/perf.md`,
    `# Baseline timings

Local Playwright, unthrottled, mock backend. This is not the throttled budget in \`04-architecture.md\` §9. D11 has not approved the look.

| Capture | Viewport | Ready (ms) |
| --- | --- | ---: |
${rows.join('\n')}

Ready means the first sell tile, stock quantity, or legacy product row was visible after navigation.
`,
  );
});
