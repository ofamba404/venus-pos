import { sbFetch } from '../api.js';
import { CATEGORIES } from '../config.js';

export const ENTITIES = ['sales', 'inventory', 'clients', 'deliveries'];

export const STALE_MS = {
  sales: 5 * 60_000,
  inventory: 30 * 60_000,
  clients: 30 * 60_000,
  deliveries: 10 * 60_000,
};

const FETCHERS = {
  sales: fetchSalesMerged,
  inventory: () => sbFetch('inventory?select=category_id,stock'),
  clients: () => sbFetch('clients?select=*&order=name.asc'),
  deliveries: () => sbFetch('deliveries?select=*&order=created_at.desc&limit=500'),
};

/** Recent sales plus any outstanding credit outside the recent window. */
async function fetchSalesMerged() {
  const [recentRes, openRes] = await Promise.all([
    // Wide recent window for charts/history; open credits merged in so old AR never drops out.
    sbFetch('sales?select=*&order=created_at.desc&limit=2000'),
    sbFetch(
      'sales?is_credit=eq.true&credit_cleared=eq.false&select=*&order=created_at.desc',
    ),
  ]);
  if (!recentRes.ok) throw new Error(`Supabase ${recentRes.status}`);
  const recent = await recentRes.json();
  if (!Array.isArray(recent)) return recent;

  if (!openRes.ok) return recent;
  const open = await openRes.json();
  if (!Array.isArray(open) || open.length === 0) return recent;

  const seen = new Set(recent.map((s) => s.id));
  const extras = open.filter((s) => s?.id && !seen.has(s.id));
  if (extras.length === 0) return recent;

  return [...recent, ...extras].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function fetchEntityFromNetwork(entity) {
  const result = await FETCHERS[entity]();
  // sales merges multiple requests and already returns parsed rows
  if (Array.isArray(result)) return result;
  if (!result.ok) throw new Error(`Supabase ${result.status}`);
  return result.json();
}

export function inventoryRowsFromState(inventory) {
  return CATEGORIES.map((c) => ({ category_id: c.id, stock: inventory[c.id] ?? 0 }));
}

export function applyInventoryRows(inventory, draftStock, rows) {
  rows.forEach((row) => {
    if (Object.hasOwn(inventory, row.category_id)) {
      inventory[row.category_id] = row.stock;
      draftStock[row.category_id] = row.stock;
    }
  });
}

function replaceArrayContents(target, rows) {
  // persistCurrent passes the live array — copy first so wipe isn't self-destructive
  const next = rows === target ? rows.slice() : rows;
  target.length = 0;
  target.push(...next);
}

export function applySales(salesCache, rows) {
  replaceArrayContents(salesCache, rows);
}

export function applyClients(clients, rows) {
  replaceArrayContents(clients, rows);
}

export function applyDeliveries(deliveries, rows) {
  replaceArrayContents(deliveries, rows);
}

export function hasEntityData(entity, { salesCache, inventory, clients, deliveries }) {
  switch (entity) {
    case 'sales':
      return salesCache.length > 0;
    case 'inventory':
      return Object.values(inventory).some((n) => n > 0);
    case 'clients':
      return clients.length > 0;
    case 'deliveries':
      return deliveries.length > 0;
    default:
      return false;
  }
}
