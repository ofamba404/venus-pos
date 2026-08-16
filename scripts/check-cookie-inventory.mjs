/**
 * Regression checks for leftover `cookie` → cookie_butterscotch mapping.
 */
import {
  canonicalInventoryCategoryId,
  normalizeInventoryBreakdown,
} from '../js/config.js';
import { applyInventoryRows } from '../js/store/repository.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(canonicalInventoryCategoryId('cookie') === 'cookie_butterscotch', 'legacy cookie id');
assert(canonicalInventoryCategoryId('cookie_mint') === 'cookie_mint', 'flavor id passthrough');

const merged = normalizeInventoryBreakdown({ cookie: 2, cookie_butterscotch: 3, cookie_mint: 1 });
assert(merged.cookie_butterscotch === 5, `merged butterscotch, got ${merged.cookie_butterscotch}`);
assert(merged.cookie_mint === 1, 'mint preserved');
assert(merged.cookie == null, 'legacy key removed');

const inventory = { cookie_butterscotch: 0, cookie_mint: 0, mint: 4 };
const draft = { cookie_butterscotch: 0, cookie_mint: 0, mint: 4 };
applyInventoryRows(inventory, draft, [
  { category_id: 'cookie', stock: 50 },
  { category_id: 'cookie_butterscotch', stock: 0 },
  { category_id: 'cookie_mint', stock: 2 },
  { category_id: 'mint', stock: 9 },
]);
assert(inventory.cookie_butterscotch === 0, 'must not display-merge leftover cookie (avoid double-count)');
assert(inventory.cookie_mint === 2, 'mint flavor applied');
assert(inventory.mint === 9, 'joint applied');
assert(!Object.hasOwn(inventory, 'cookie'), 'must not create legacy key on client');

console.log('check-cookie-inventory: ok');
