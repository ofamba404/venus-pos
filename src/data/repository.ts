import { CATEGORIES, canonicalInventoryCategoryId } from '../domain/catalog';
import { sbFetch } from './api';

/** Same entity set and stale windows as `legacy/js/store/repository.js`. */
export const ENTITIES = ['sales', 'inventory', 'clients', 'deliveries'] as const;
export type EntityName = (typeof ENTITIES)[number];

export const STALE_MS: Record<EntityName, number> = {
  sales: 15 * 60_000,
  inventory: 20_000,
  clients: 30 * 60_000,
  deliveries: 15 * 60_000,
};

/** v1 query strings. Clients in the app stay `select=*` so the sheet can show a phone. */
export const QUERIES = {
  salesRecent: 'sales?select=*&order=created_at.desc&limit=2000',
  salesOpenCredit:
    'sales?is_credit=eq.true&credit_cleared=eq.false&select=*&order=created_at.desc',
  inventory: 'inventory?select=category_id,stock',
  clients: 'clients?select=id,name,created_at&order=name.asc',
  clientsApp: 'clients?select=*&order=name.asc&limit=500',
  deliveries:
    'deliveries?select=id,client_id,client_name,sale_id,origin_lat,origin_lng,origin_label,dest_lat,dest_lng,dest_label,distance_km,duration_min,fee_ugx,predicted_fee_ugx,fee_was_edited,created_at&order=created_at.desc&limit=500',
  storeOrders:
    'store_orders?or=(status.in.(pending,confirmed,accepted),and(status.eq.cancelled,dismissed_at.is.null))&order=created_at.desc&limit=40',
} as const;

type SaleLike = { id?: string; created_at?: string };

export function mergeSalesRows<T extends SaleLike>(recent: T[], open: T[]): T[] {
  if (!open.length) return recent;
  const seen = new Set(recent.map((row) => row.id));
  const extras = open.filter((row) => row?.id && !seen.has(row.id));
  if (!extras.length) return recent;
  return [...recent, ...extras].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
}

export type InventoryMap = Record<string, number>;

export function emptyInventoryMap(): InventoryMap {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
}

/** v1 `applyInventoryRows`: skip the shared `cookie` alias, ignore unknown ids. */
export function inventoryMapFromRows(
  rows: unknown,
  base: InventoryMap = emptyInventoryMap(),
): { map: InventoryMap; applied: number } {
  const next = { ...base };
  let applied = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const categoryId = String((row as { category_id?: string }).category_id || '');
    if (!categoryId) continue;
    const canon = canonicalInventoryCategoryId(categoryId);
    if (canon !== categoryId) continue;
    if (!Object.prototype.hasOwnProperty.call(next, canon)) continue;
    const stock = Math.max(0, Math.floor(Number((row as { stock?: unknown }).stock) || 0));
    next[canon] = stock;
    applied += 1;
  }
  return { map: next, applied };
}

export function inventoryRowsFromMap(map: InventoryMap): { category_id: string; stock: number }[] {
  return CATEGORIES.map((c) => ({ category_id: c.id, stock: map[c.id] ?? 0 }));
}

/** Never replace a non-empty cache with an empty server payload. */
export function keepCachedRows(rows: unknown, hadData: boolean, trustEmpty = false): boolean {
  return !trustEmpty && Array.isArray(rows) && rows.length === 0 && hadData;
}

export async function fetchSalesMerged(): Promise<SaleLike[]> {
  const [recentRes, openRes] = await Promise.all([
    sbFetch(QUERIES.salesRecent),
    sbFetch(QUERIES.salesOpenCredit),
  ]);
  if (!recentRes.ok) throw new Error(`Supabase ${recentRes.status}`);
  const recent = await recentRes.json();
  if (!Array.isArray(recent)) return [];
  if (!openRes.ok) return recent;
  const open = await openRes.json();
  if (!Array.isArray(open)) return recent;
  return mergeSalesRows(recent, open);
}

export async function fetchClients(): Promise<unknown[]> {
  const res = await sbFetch(QUERIES.clientsApp);
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

const loads = new Map<string, Promise<unknown>>();

/** One network read per entity while a fetch is already running. */
export function shareLoad<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = loads.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const work = run().finally(() => {
    if (loads.get(key) === work) loads.delete(key);
  });
  loads.set(key, work);
  return work;
}

export async function fetchDeliveries(): Promise<unknown[]> {
  const res = await sbFetch(QUERIES.deliveries);
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export async function fetchStoreOrders(): Promise<unknown[]> {
  const res = await sbFetch(QUERIES.storeOrders);
  if (!res.ok) throw new Error(`store_orders ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}
