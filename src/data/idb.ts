import { KEYS } from './keys';

/** venus-pos v3: v1 `cache`, device `held`, offline `outbox`. */
const DB_VERSION = 3;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openPosDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(KEYS.idbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEYS.idbCacheStore)) {
        db.createObjectStore(KEYS.idbCacheStore, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(KEYS.idbHeldStore)) {
        db.createObjectStore(KEYS.idbHeldStore, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(KEYS.idbOutboxStore)) {
        db.createObjectStore(KEYS.idbOutboxStore, { keyPath: 'clientSaleId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** Test-only. The next openPosDb() talks to IndexedDB again. */
export function resetPosDbForTests() {
  dbPromise = null;
}

export type CacheEntry = { ts: number; data: unknown };

/** v1 row shape: `{ key, ts, data }` in the `cache` store. */
export async function idbRead(key: string): Promise<CacheEntry | null> {
  try {
    const db = await openPosDb();
    const row = await new Promise<{ key?: string; ts?: number; data?: unknown } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(KEYS.idbCacheStore, 'readonly');
        const req = tx.objectStore(KEYS.idbCacheStore).get(key);
        req.onsuccess = () => resolve(req.result as { key?: string; ts?: number; data?: unknown } | undefined);
        req.onerror = () => reject(req.error);
      },
    );
    if (!row || row.data == null) return null;
    return { ts: Number(row.ts) || 0, data: row.data };
  } catch {
    return null;
  }
}

export async function idbWrite(key: string, data: unknown, now = Date.now()): Promise<void> {
  const db = await openPosDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEYS.idbCacheStore, 'readwrite');
    tx.objectStore(KEYS.idbCacheStore).put({ key, ts: now, data });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
