import { functionFetch, sbFetch } from './api';
import { KEYS } from './keys';
import { openPosDb } from './idb';

/** One queued counter sale. `clientSaleId` is the idempotency key once the column exists. */
export type OutboxSale = {
  clientSaleId: string;
  body: Record<string, unknown>;
  deltas: Record<string, number>;
  createdAt: string;
  label: string;
  salePosted?: boolean;
};

const memory: OutboxSale[] = [];

export function shouldQueueSale(error: unknown, storeOrderId: string): boolean {
  if (String(storeOrderId || '').trim()) return false;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /failed to fetch|network|offline|load failed/i.test(message);
}

function remember(sale: OutboxSale) {
  const index = memory.findIndex((row) => row.clientSaleId === sale.clientSaleId);
  if (index >= 0) memory[index] = sale;
  else memory.push(sale);
}

export async function listOutbox(): Promise<OutboxSale[]> {
  if (typeof indexedDB === 'undefined') return [...memory];
  try {
    const db = await openPosDb();
    const tx = db.transaction(KEYS.idbOutboxStore, 'readonly');
    const rows = await new Promise<OutboxSale[]>((resolve, reject) => {
      const req = tx.objectStore(KEYS.idbOutboxStore).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });
    return rows;
  } catch {
    return [...memory];
  }
}

export async function enqueueSale(sale: OutboxSale): Promise<void> {
  remember(sale);
  if (typeof indexedDB === 'undefined') return;
  const db = await openPosDb();
  const tx = db.transaction(KEYS.idbOutboxStore, 'readwrite');
  tx.objectStore(KEYS.idbOutboxStore).put(sale);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeOutbox(clientSaleId: string): Promise<void> {
  const index = memory.findIndex((row) => row.clientSaleId === clientSaleId);
  if (index >= 0) memory.splice(index, 1);
  if (typeof indexedDB === 'undefined') return;
  const db = await openPosDb();
  const tx = db.transaction(KEYS.idbOutboxStore, 'readwrite');
  tx.objectStore(KEYS.idbOutboxStore).delete(clientSaleId);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function outboxCountLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 sale waiting to sync' : `${count} sales waiting to sync`;
}

async function postQueuedSale(row: OutboxSale): Promise<'ok' | 'blocked' | 'retry'> {
  let res: Response;
  try {
    res = await sbFetch('sales', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(row.body),
    });
  } catch {
    return 'retry';
  }
  if (res.ok || res.status === 409) return 'ok';
  const text = await res.text().catch(() => '');
  if (res.status === 400 && /client_sale_id/i.test(text)) return 'blocked';
  if (res.status >= 500 || res.status === 0) return 'retry';
  return 'blocked';
}

/** Push queued counter sales. Stops on the first row that cannot land yet. */
export async function flushOutbox(): Promise<{ synced: number; pending: number; blocked: boolean }> {
  const rows = await listOutbox();
  let synced = 0;
  for (const row of rows) {
    if (!row.salePosted) {
      const posted = await postQueuedSale(row);
      if (posted !== 'ok') {
        const pending = (await listOutbox()).length;
        return { synced, pending, blocked: posted === 'blocked' };
      }
      row.salePosted = true;
      await enqueueSale(row);
    }
    try {
      await Promise.all(
        Object.entries(row.deltas).map(([category_id, qty]) =>
          functionFetch('/api/inventory/write', {
            op: 'delta',
            category_id,
            delta: -Number(qty),
          }),
        ),
      );
    } catch {
      const pending = (await listOutbox()).length;
      return { synced, pending, blocked: false };
    }
    await removeOutbox(row.clientSaleId);
    synced += 1;
  }
  return { synced, pending: 0, blocked: false };
}
