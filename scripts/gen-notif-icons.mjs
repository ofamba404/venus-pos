/**
 * Builds the /next notification icons from the brand SVGs (ink + white mark).
 *   public/notif/venus-notif-icon-r2-192.png  192px ink circle (as the storefront's) with the white mark (notification `icon`)
 *   public/notif/venus-notif-badge-r2-96.png  96px white leaf silhouette on transparent (Android status-bar `badge`)
 * Bump the `r2` in the names when the art changes so phones fetch the new file.
 * Run: node scripts/gen-notif-icons.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ink = readFileSync('public/assets/logo-ink.svg', 'utf8');
const badge = readFileSync('public/assets/logo-badge.svg', 'utf8');
const leafPath = badge.match(/<path d="([^"]+)"/)[1]; // first path is the leaf, the second is the wordmark
mkdirSync('public/notif', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 192, height: 192 }, deviceScaleFactor: 1 });

await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:192px;height:192px}</style>${ink.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '').replace(/width="1414" height="1414"/, 'width="192" height="192"').replace(/<rect width="1414" height="1414"/, '<circle cx="707" cy="707" r="707"')}`);
writeFileSync('public/notif/venus-notif-icon-r2-192.png', await page.screenshot({ omitBackground: true }));

// Badge: the leaf alone, centred in a square with a little padding. Android keeps only the alpha, so it is pure white.
await page.setViewportSize({ width: 96, height: 96 });
await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:96px;height:96px}</style><svg id="s" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g transform="translate(707 707) scale(0.88) translate(-707 -707)"><path id="leaf" fill="#fff" d="${leafPath}"/></g></svg>`);
await page.evaluate(() => {
  const leaf = document.getElementById('leaf');
  const g = leaf.parentNode;
  const b = g.getBBox();
  const side = Math.max(b.width, b.height) * 1.12;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  document.getElementById('s').setAttribute('viewBox', `${cx - side / 2} ${cy - side / 2} ${side} ${side}`);
});
writeFileSync('public/notif/venus-notif-badge-r2-96.png', await page.screenshot({ omitBackground: true }));
await browser.close();
