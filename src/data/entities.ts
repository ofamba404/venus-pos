import { signal } from '@preact/signals';
import { CATEGORIES } from '../domain/catalog';
import { sbFetch } from './api';
import { functionFetch } from './api';
import { allowDevBypass, peekAccessToken } from './auth';

export type InventoryMap = Record<string, number>;

export type SaleRow = {
  id: string;
  created_at?: string;
  total_ugx?: number;
  client_id?: string | null;
  is_credit?: boolean;
  credit_cleared?: boolean;
  amount_paid_ugx?: number;
  items?: unknown[];
  client_phone?: string | null;
  store_order_id?: string | null;
  [key: string]: unknown;
};

export type ClientRow = {
  id: string;
  name?: string;
  phone?: string | null;
  [key: string]: unknown;
};

export type StoreOrderRow = {
  id: string;
  status?: string;
  created_at?: string;
  phone_e164?: string;
  delivery_enabled?: boolean;
  delivery?: { mode?: string; label?: string; deliverAt?: string };
  delivery_fee_ugx?: number | null;
  delivery_distance_km?: number | null;
  delivery_duration_min?: number | null;
  location_label?: string;
  location_lat?: number | null;
  location_lng?: number | null;
  items?: unknown[];
  customer_name?: string;
  confirmed_at?: string | null;
  dismissed_at?: string | null;
  [key: string]: unknown;
};

function emptyInventory(): InventoryMap {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
}

export const inventory = signal<InventoryMap>(emptyInventory());
export const inventoryReady = signal(false);
export const sales = signal<SaleRow[]>([]);
export const clients = signal<ClientRow[]>([]);
export const storeOrders = signal<StoreOrderRow[]>([]);
export const syncLabel = signal<'idle' | 'syncing' | 'live' | 'offline'>('idle');

export async function ensureInventory() {
  syncLabel.value = 'syncing';
  try {
    if (!peekAccessToken() && allowDevBypass()) {
      inventoryReady.value = true;
      syncLabel.value = 'offline';
      return inventory.value;
    }
    const data = await functionFetch('/api/inventory/write', { op: 'ensure' });
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const next = emptyInventory();
    for (const row of rows) {
      const id = String(row.category_id || '');
      if (id in next) next[id] = Math.max(0, Math.round(Number(row.stock) || 0));
    }
    inventory.value = next;
    inventoryReady.value = true;
    syncLabel.value = 'live';
    return next;
  } catch (e) {
    console.warn('inventory ensure failed', e);
    inventoryReady.value = true;
    syncLabel.value = 'offline';
    return inventory.value;
  }
}

export async function loadSales() {
  const res = await sbFetch('sales?select=*&order=created_at.desc&limit=200');
  if (!res.ok) throw new Error(`sales ${res.status}`);
  sales.value = (await res.json()) as SaleRow[];
  return sales.value;
}

export async function loadClients() {
  const res = await sbFetch('clients?select=*&order=name.asc&limit=500');
  if (!res.ok) throw new Error(`clients ${res.status}`);
  clients.value = (await res.json()) as ClientRow[];
  return clients.value;
}

export async function loadStoreOrders() {
  const q =
    'store_orders?or=(status.in.(pending,confirmed,accepted),and(status.eq.cancelled,dismissed_at.is.null))&order=created_at.desc&limit=40';
  const res = await sbFetch(q);
  if (!res.ok) throw new Error(`store_orders ${res.status}`);
  storeOrders.value = (await res.json()) as StoreOrderRow[];
  return storeOrders.value;
}

async function writeStockChange(id: string, prev: number, nextQty: number, delta: number) {
  try {
    await functionFetch('/api/inventory/write', {
      op: 'delta',
      category_id: id,
      delta,
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 405 || status === 502 || status === 503) {
      const res = await sbFetch(`inventory?category_id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stock: nextQty }),
      });
      if (res.ok) return;
    }
    inventory.value = { ...inventory.value, [id]: prev };
    throw e;
  }
}

export async function adjustInventory(categoryId: string, delta: number) {
  const id = String(categoryId);
  const prev = inventory.value[id] || 0;
  const nextQty = Math.max(0, prev + delta);
  inventory.value = { ...inventory.value, [id]: nextQty };
  await writeStockChange(id, prev, nextQty, delta);
}

export async function setInventoryCount(categoryId: string, qty: number) {
  const id = String(categoryId);
  const prev = inventory.value[id] || 0;
  const nextQty = Math.max(0, Math.round(Number(qty) || 0));
  const delta = nextQty - prev;
  if (delta === 0) return nextQty;
  inventory.value = { ...inventory.value, [id]: nextQty };
  await writeStockChange(id, prev, nextQty, delta);
  return nextQty;
}

export async function bootstrapEntities() {
  await ensureInventory();
  if (!peekAccessToken() && allowDevBypass()) return;
  await Promise.allSettled([loadSales(), loadClients(), loadStoreOrders()]);
}
