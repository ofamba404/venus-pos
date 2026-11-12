/**
 * Phase 1 exit check: dist/ outside /next/ matches v1 byte for byte.
 * Every file under legacy/ must match dist/<same path>.
 * dist/assets must match public/assets (shared by v1 and v2).
 * dist/next is the Vite build and is not compared.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacyRoot = join(root, 'legacy');
const distRoot = join(root, 'dist');
const assetsRoot = join(root, 'public', 'assets');

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function relPosix(from, file) {
  return relative(from, file).split(sep).join('/');
}

const failures = [];

if (!existsSync(distRoot)) {
  console.error('dist/ is missing. Run npm run build first.');
  process.exit(1);
}

const legacyFiles = walk(legacyRoot);
for (const file of legacyFiles) {
  const rel = relPosix(legacyRoot, file);
  const distFile = join(distRoot, rel);
  if (!existsSync(distFile)) {
    failures.push(`missing dist/${rel}`);
    continue;
  }
  const left = sha256(file);
  const right = sha256(distFile);
  if (left !== right) failures.push(`hash mismatch legacy/${rel}`);
}

const distFiles = walk(distRoot);
for (const file of distFiles) {
  const rel = relPosix(distRoot, file);
  if (rel === 'next' || rel.startsWith('next/')) continue;
  if (rel === 'assets' || rel.startsWith('assets/')) {
    const source = join(root, 'public', rel);
    if (!existsSync(source)) failures.push(`dist/${rel} is not in public/`);
    else if (sha256(file) !== sha256(source)) failures.push(`hash mismatch public/${rel}`);
    continue;
  }
  const source = join(legacyRoot, rel);
  if (!existsSync(source)) failures.push(`unexpected dist/${rel}`);
  else if (sha256(file) !== sha256(source)) failures.push(`hash mismatch dist/${rel}`);
}

for (const file of walk(assetsRoot)) {
  const rel = `assets/${relPosix(assetsRoot, file)}`;
  const distFile = join(distRoot, rel);
  if (!existsSync(distFile)) failures.push(`missing dist/${rel}`);
}

if (failures.length) {
  for (const line of failures) console.error(line);
  console.error(`${failures.length} difference(s). v1 in dist/ is not byte-identical.`);
  process.exit(1);
}

console.log(
  `legacy dist check ok: ${legacyFiles.length} legacy files match dist/, assets match public/assets, dist/next ignored`,
);
