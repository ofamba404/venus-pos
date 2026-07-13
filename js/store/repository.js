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
  sales: () => sbFetch('sales?select=*&order=created_at.desc&limit=200'),
  inventory: () => sbFetch('inventory?select=category_id,stock'),
  clients: () => sbFetch('clients?select=*&order=name.asc'),
  deliveries: () => sbFetch('deliveries?select=*&order=created_at.desc&limit=500'),
};

export async function fetchEntityFromNetwork(entity) {
  const res = await FETCHERS[entity]();
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
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

export function applySales(salesCache, rows) {
  salesCache.length = 0;
  salesCache.push(...rows);
}

export function applyClients(clients, rows) {
  clients.length = 0;
  clients.push(...rows);
}

export function applyDeliveries(deliveries, rows) {
  deliveries.length = 0;
  deliveries.push(...rows);
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
