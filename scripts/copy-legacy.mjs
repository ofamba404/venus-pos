/**
 * After Vite builds dist/next/, copy frozen v1 from legacy/ to dist/ root
 * so production still serves the current POS until cutover.
 */
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacy = join(root, 'legacy');
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });

const entries = [
  'index.html',
  'auth.html',
  'sw.js',
  'manifest.webmanifest',
  'pages',
  'js',
  'css',
  'vendor',
];

for (const name of entries) {
  const from = join(legacy, name);
  const to = join(dist, name);
  if (!existsSync(from)) {
    console.warn(`skip missing ${name}`);
    continue;
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`copied legacy/${name} → dist/${name}`);
}

// Shared assets
const assetsFrom = join(root, 'public', 'assets');
const assetsTo = join(dist, 'assets');
if (existsSync(assetsFrom)) {
  rmSync(assetsTo, { recursive: true, force: true });
  cpSync(assetsFrom, assetsTo, { recursive: true });
  console.log('copied public/assets → dist/assets');
}

console.log('copy-legacy done');
