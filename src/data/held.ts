import type { HeldSale } from '../domain/cart';
import { openPosDb } from './idb';
import { KEYS } from './keys';

/**
 * Parked counter sales. IndexedDB store `held` on database `venus-pos` (version 2).
 * Nothing is written to Supabase. Tests without IndexedDB use an in-memory list.
 */
const memory = new Map<string, HeldSale>();

function memoryList(): HeldSale[] {
  return [...memory.values()].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listHeld(): Promise<HeldSale[]> {
  if (typeof indexedDB === 'undefined') return memoryList();
  try {
    const db = await openPosDb();
    const tx = db.transaction(KEYS.idbHeldStore, 'readonly');
    const rows = await request(tx.objectStore(KEYS.idbHeldStore).getAll());
    return (Array.isArray(rows) ? rows : []).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  } catch {
    return memoryList();
  }
}

export async function saveHeld(sale: HeldSale): Promise<void> {
  if (!sale?.id || !sale.lines?.length) return;
  if (typeof indexedDB === 'undefined') {
    memory.set(sale.id, sale);
    return;
  }
  const db = await openPosDb();
  const tx = db.transaction(KEYS.idbHeldStore, 'readwrite');
  tx.objectStore(KEYS.idbHeldStore).put(sale);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteHeld(id: string): Promise<void> {
  if (!id) return;
  memory.delete(id);
  if (typeof indexedDB === 'undefined') return;
  const db = await openPosDb();
  const tx = db.transaction(KEYS.idbHeldStore, 'readwrite');
  tx.objectStore(KEYS.idbHeldStore).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
