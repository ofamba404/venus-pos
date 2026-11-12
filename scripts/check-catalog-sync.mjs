/**
 * Fail when catalog.ts disagrees with inventory-write category meta,
 * or with the sibling venus-store catalog when that repo is checked out
 * next to this one.
 *
 * Storefront checks are skipped with a warning when ../venus-store is absent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PRODUCTS } from '../src/domain/catalog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function extractAssigned(source, name) {
  const token = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`);
  const match = token.exec(source);
  if (!match) return null;
  const start = source.indexOf('{', match.index + match[0].length);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function evalObject(literal, label) {
  if (!literal) fail(`could not read ${label}`);
  try {
    return Function(`"use strict"; return (${literal});`)();
  } catch (error) {
    fail(`could not parse ${label}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function readConstNumber(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
}

function checkInventoryMeta() {
  const file = path.join(root, 'netlify/functions/inventory-write.mjs');
  const source = fs.readFileSync(file, 'utf8');
  const meta = evalObject(extractAssigned(source, 'CATEGORY_META'), 'CATEGORY_META');
  if (!meta) return;
  const allowedExtra = new Set(['cookie']);
  const catalogIds = new Set(CATEGORIES.map((category) => category.id));
  for (const category of CATEGORIES) {
    const row = meta[category.id];
    if (!row) {
      fail(`inventory-write is missing ${category.id}`);
      continue;
    }
    if (row.display_name !== category.name) {
      fail(`${category.id} name ${row.display_name} != ${category.name}`);
    }
    if ((row.category_sub || '') !== (category.sub || '')) {
      fail(`${category.id} sub ${row.category_sub} != ${category.sub}`);
    }
    if (String(row.color).toLowerCase() !== category.color.toLowerCase()) {
      fail(`${category.id} color ${row.color} != ${category.color}`);
    }
  }
  for (const id of Object.keys(meta)) {
    if (!catalogIds.has(id) && !allowedExtra.has(id)) {
      fail(`inventory-write has unexpected category ${id}`);
    }
  }
}

function domainFlavoredConstants() {
  const source = fs.readFileSync(path.join(root, 'src/domain/pricing/flavored-bulk.ts'), 'utf8');
  return {
    threshold: readConstNumber(source, 'THRESHOLD'),
    bulk: readConstNumber(source, 'SINGLE_BULK_UGX'),
    unit: readConstNumber(source, 'SINGLE_UNIT_UGX'),
  };
}

function checkStorefront(storeRoot) {
  const domain = domainFlavoredConstants();
  const pricingPath = path.join(storeRoot, 'js/shared/flavored-cookie-pricing.js');
  const productsPath = path.join(storeRoot, 'js/shared/products-catalog.js');
  const syncPath = path.join(storeRoot, 'js/shared/store-order-sync.js');
  for (const file of [pricingPath, productsPath, syncPath]) {
    if (!fs.existsSync(file)) fail(`missing storefront file ${path.relative(storeRoot, file)}`);
  }
  if (!fs.existsSync(pricingPath)) return;

  const pricing = fs.readFileSync(pricingPath, 'utf8');
  const threshold = readConstNumber(pricing, 'THRESHOLD');
  const bulk = readConstNumber(pricing, 'SINGLE_BULK_UGX');
  const unit = readConstNumber(pricing, 'SINGLE_UNIT_UGX');
  if (threshold !== domain.threshold) {
    fail(`storefront THRESHOLD ${threshold} != ${domain.threshold}`);
  }
  if (bulk !== domain.bulk) fail(`storefront SINGLE_BULK_UGX ${bulk} != ${domain.bulk}`);
  if (unit !== domain.unit) fail(`storefront SINGLE_UNIT_UGX ${unit} != ${domain.unit}`);

  const packBase = evalObject(extractAssigned(pricing, 'PACK_BASE_UGX'), 'PACK_BASE_UGX');
  if (packBase) {
    for (const [id, price] of Object.entries(packBase)) {
      const product = PRODUCTS.find((row) => row.id === id);
      if (!product) fail(`storefront pack ${id} is not in catalog.ts`);
      else if (product.price !== price) fail(`${id} price ${price} != catalog ${product.price}`);
    }
  }

  if (!fs.existsSync(productsPath) || !fs.existsSync(syncPath)) return;
  const products = fs.readFileSync(productsPath, 'utf8');
  for (const product of PRODUCTS) {
    if (product.price == null && product.unitPrice == null && product.joints == null) continue;
    if (!products.includes(product.id) && !products.includes(product.id.replace(/_/g, '-'))) {
      fail(`products-catalog.js does not mention ${product.id}`);
    }
  }

  const syncLines = fs.readFileSync(syncPath, 'utf8').split(/\r?\n/).slice(11, 26).join('\n');
  const mentioned = [...syncLines.matchAll(/['"]([a-z0-9_-]+)['"]/g)].map((match) => match[1]);
  const known = new Set([
    ...CATEGORIES.map((category) => category.id),
    ...PRODUCTS.map((product) => product.id),
    ...CATEGORIES.map((category) => category.id.replace(/_/g, '-')),
    ...PRODUCTS.map((product) => product.id.replace(/_/g, '-')),
  ]);
  for (const id of mentioned) {
    const snake = id.replace(/-/g, '_');
    if (!known.has(id) && !known.has(snake)) {
      fail(`store-order-sync.js id ${id} is not in catalog.ts`);
    }
  }
}

checkInventoryMeta();
const storeRoot = path.resolve(root, '..', 'venus-store');
if (!fs.existsSync(storeRoot)) {
  console.warn('check-catalog-sync: ../venus-store is absent; skipping storefront price, pack, id, and colour checks');
} else {
  checkStorefront(storeRoot);
}

if (failures.length) {
  console.error(`check-catalog-sync: ${failures.length} mismatch(es)`);
  for (const message of failures) console.error(`  ${message}`);
  process.exit(1);
}
console.log(`check-catalog-sync: inventory categories match catalog.ts (${CATEGORIES.length} ids)`);
