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
