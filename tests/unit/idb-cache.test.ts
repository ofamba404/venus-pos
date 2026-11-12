import { describe, expect, it } from 'vitest';
import { KEYS } from '../../src/data/keys';
import { idbRead, idbWrite, resetPosDbForTests } from '../../src/data/idb';

type Row = { key: string; ts: number; data: unknown };

function installFakeIndexedDb() {
  const dbs = new Map<string, { version: number; stores: Map<string, Map<string, Row>> }>();

  function request<T>(produce: () => T) {
    const req = {
      result: undefined as T | undefined,
      error: null as unknown,
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
      onupgradeneeded: null as null | (() => void),
    };
    queueMicrotask(() => {
      try {
        req.result = produce();
        req.onsuccess?.();
      } catch (error) {
        req.error = error;
        req.onerror?.();
      }
    });
    return req;
  }

  globalThis.indexedDB = {
    open(name: string, version: number) {
      const req = {
        result: null as unknown,
        error: null as unknown,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
      };
      queueMicrotask(() => {
        let db = dbs.get(name);
        const fresh = !db || db.version < version;
        if (!db) {
          db = { version, stores: new Map() };
          dbs.set(name, db);
        }
        const current = db;
        const handle = {
          version,
          objectStoreNames: {
            contains: (store: string) => current.stores.has(store),
          },
          createObjectStore(store: string) {
            current.stores.set(store, new Map());
            return {};
          },
          transaction(store: string) {
            const rows = current.stores.get(store) || new Map<string, Row>();
            current.stores.set(store, rows);
            const tx = {
              oncomplete: null as null | (() => void),
              onerror: null as null | (() => void),
              objectStore() {
                return {
                  get(key: string) {
                    return request(() => rows.get(key));
                  },
                  put(value: Row) {
                    rows.set(value.key, value);
                    return request(() => value);
                  },
                };
              },
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        };
        req.result = handle;
        if (fresh) {
          current.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
}

describe('idb v1 cache rows', () => {
  it('reads a { key, ts, data } row written in the cache store', async () => {
    installFakeIndexedDb();
    resetPosDbForTests();
    const payload = [{ id: 'v1-sale', total_ugx: 8000 }];
    await idbWrite('sales', payload, 1000);
    const row = await idbRead('sales');
    expect(row).toEqual({ ts: 1000, data: payload });
    expect(KEYS.idbName).toBe('venus-pos');
    expect(KEYS.idbCacheStore).toBe('cache');
  });
});
