/**
 * Shell + Sell initial budget from docs/overhaul/04-architecture.md §9.
 * Sell is in the main chunk. CSS is every dist/next/assets stylesheet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = path.resolve('dist/next/assets');
const files = fs.readdirSync(dir);
const main = files.find((name) => name.startsWith('main-') && name.endsWith('.js'));
const css = files.filter((name) => name.endsWith('.css'));
if (!main) {
  console.error('check-size: main JS chunk missing. Run npm run build first.');
  process.exit(1);
}

function gzipBytes(name) {
  return gzipSync(fs.readFileSync(path.join(dir, name))).length;
}

const js = gzipBytes(main);
const cssBytes = css.reduce((sum, name) => sum + gzipBytes(name), 0);
const jsLimit = 60 * 1024;
const cssLimit = 20 * 1024;
console.log(`check-size: ${main} ${js} bytes gzip (limit ${jsLimit})`);
console.log(`check-size: css ${cssBytes} bytes gzip across ${css.length} files (limit ${cssLimit})`);
if (js > jsLimit || cssBytes > cssLimit) process.exit(1);
