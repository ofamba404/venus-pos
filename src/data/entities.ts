import { signal } from '@preact/signals';
import { sbFetch } from './api';
import { functionFetch } from './api';
import { allowDevBypass, peekAccessToken } from './auth';
import { isFresh, markFetched } from './freshness';
import { hydrateEntities } from './hydrate';
import { idbWrite } from './idb';
import {
  emptyInventoryMap,
  fetchClients,
  fetchDeliveries,
  fetchSalesMerged,
  inventoryMapFromRows,
  inventoryRowsFromMap,
  keepCachedRows,
  type EntityName,
  type InventoryMap,
} from './repository';
import { inventoryDeltaBody, inventoryEnsureBody, inventoryPatchBody, inventoryPatchPath } from './writes/inventory';

export type { InventoryMap };

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
  return emptyInventoryMap();
}

export type DeliveryRow = {
  id: string;
  sale_id?: string | null;
  [key: string]: unknown;
};

export const inventory = signal<InventoryMap>(emptyInventory());
export const inventoryReady = signal(false);
export const sales = signal<SaleRow[]>([]);
export const clients = signal<ClientRow[]>([]);
export const storeOrders = signal<StoreOrderRow[]>([]);
export const deliveries = signal<DeliveryRow[]>([]);
export const syncLabel = signal<'idle' | 'syncing' | 'live' | 'offline'>('idle');

export function applyCachedEntity(entity: EntityName, data: unknown) {
  if (entity === 'sales' && Array.isArray(data)) {
    sales.value = data as SaleRow[];
    return;
  }
  if (entity === 'clients' && Array.isArray(data)) {
    clients.value = data as ClientRow[];
    return;
  }
  if (entity === 'deliveries' && Array.isArray(data)) {
    deliveries.value = data as DeliveryRow[];
    return;
  }
  if (entity === 'inventory') {
    const { map, applied } = inventoryMapFromRows(data, inventory.value);
    if (applied > 0) {
      inventory.value = map;
      inventoryReady.value = true;
    }
  }
}

async function persistSnapshot(entity: EntityName, data: unknown, opts?: { bump?: boolean }) {
  try {
    await idbWrite(entity, data);
  } catch {
    return;
  }
  if (opts?.bump !== false) markFetched(entity, Date.now());
}

export async function ensureInventory() {
  syncLabel.value = 'syncing';
  try {
    if (!peekAccessToken() && allowDevBypass()) {
      inventoryReady.value = true;
      syncLabel.value = 'offline';
      return inventory.value;
    }
    const data = await functionFetch('/api/inventory/write', inventoryEnsureBody());
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const next = emptyInventory();
    for (const row of rows) {
      const id = String(row.category_id || '');
      if (id in next) next[id] = Math.max(0, Math.round(Number(row.stock) || 0));
    }
    if (keepCachedRows(rows, inventoryReady.value)) {
      markFetched('inventory', Date.now());
      syncLabel.value = 'live';
      return inventory.value;
    }
    inventory.value = next;
    inventoryReady.value = true;
    syncLabel.value = 'live';
    await persistSnapshot('inventory', inventoryRowsFromMap(next));
    return next;
  } catch (e) {
    console.warn('inventory ensure failed', e);
    inventoryReady.value = true;
    syncLabel.value = 'offline';
    return inventory.value;
  }
}

export async function loadSales(opts?: { force?: boolean }) {
  if (!opts?.force && isFresh('sales')) return sales.value;
  const rows = (await fetchSalesMerged()) as SaleRow[];
  if (keepCachedRows(rows, sales.value.length > 0)) {
    markFetched('sales', Date.now());
    return sales.value;
  }
  sales.value = rows;
  await persistSnapshot('sales', rows);
  return sales.value;
}

export async function loadClients(opts?: { force?: boolean }) {
  if (!opts?.force && isFresh('clients')) return clients.value;
  const rows = (await fetchClients()) as ClientRow[];
  if (keepCachedRows(rows, clients.value.length > 0)) {
    markFetched('clients', Date.now());
    return clients.value;
  }
  clients.value = rows;
  await persistSnapshot('clients', rows);
  return clients.value;
}

export async function loadDeliveries(opts?: { force?: boolean }) {
  if (!opts?.force && isFresh('deliveries')) return deliveries.value;
  const rows = (await fetchDeliveries()) as DeliveryRow[];
  if (keepCachedRows(rows, deliveries.value.length > 0)) {
    markFetched('deliveries', Date.now());
    return deliveries.value;
  }
  deliveries.value = rows;
  await persistSnapshot('deliveries', rows);
  return deliveries.value;
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
    await functionFetch('/api/inventory/write', inventoryDeltaBody(id, delta));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 405 || status === 502 || status === 503) {
      const res = await sbFetch(inventoryPatchPath(id), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(inventoryPatchBody(nextQty)),
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
  await persistSnapshot('inventory', inventoryRowsFromMap(inventory.value), { bump: false });
}

export async function setInventoryCount(categoryId: string, qty: number) {
  const id = String(categoryId);
  const prev = inventory.value[id] || 0;
  const nextQty = Math.max(0, Math.round(Number(qty) || 0));
  const delta = nextQty - prev;
  if (delta === 0) return nextQty;
  inventory.value = { ...inventory.value, [id]: nextQty };
  await writeStockChange(id, prev, nextQty, delta);
  await persistSnapshot('inventory', inventoryRowsFromMap(inventory.value), { bump: false });
  return nextQty;
}

export async function bootstrapEntities() {
  await hydrateEntities((entity, data) => applyCachedEntity(entity, data));
  await ensureInventory();
  if (!peekAccessToken() && allowDevBypass()) return;
  await Promise.allSettled([loadSales(), loadClients(), loadDeliveries(), loadStoreOrders()]);
}
