const DB_NAME = 'venus-pos';
const DB_VERSION = 1;
const STORE = 'cache';
const SESSION_PREFIX = 'venus-pos-cache:';

let dbPromise = null;

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      migrateSessionStorage(req.result)
        .then(() => resolve(req.result))
        .catch(() => resolve(req.result));
    };
  });
  return dbPromise;
}

async function migrateSessionStorage(db) {
  const keys = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k?.startsWith(SESSION_PREFIX)) keys.push(k);
  }
  if (!keys.length) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    keys.forEach((fullKey) => {
      try {
        const raw = sessionStorage.getItem(fullKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const entityKey = fullKey.slice(SESSION_PREFIX.length);
        store.put({ key: entityKey, ts: parsed.ts ?? Date.now(), data: parsed.data });
        sessionStorage.removeItem(fullKey);
      } catch {
        /* skip corrupt entries */
      }
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbRead(key, maxAge = Infinity) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const row = await idbRequest(tx.objectStore(STORE).get(key));
    if (!row?.data) return null;
    if (maxAge >= 0 && Date.now() - row.ts > maxAge) return null;
    return { ts: row.ts, data: row.data };
  } catch {
    return null;
  }
}

export async function idbReadStale(key) {
  return idbRead(key, Infinity);
}

export async function idbWrite(key, data) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, ts: Date.now(), data });
    await idbTx(tx);
  } catch {
    /* storage full or unavailable */
  }
}

export async function idbClear(key) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    await idbTx(tx);
  } catch {
    /* ignore */
  }
}

export async function idbGetMeta(key) {
  const row = await idbReadStale(key);
  return row ? { ts: row.ts, hasData: row.data != null } : { ts: 0, hasData: false };
}
