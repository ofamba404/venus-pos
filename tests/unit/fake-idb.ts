type Row = { key?: string; id?: string; clientSaleId?: string; ts?: number; data?: unknown };

export function installFakeIndexedDb() {
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
                    const id = value.key || value.id || value.clientSaleId || '';
                    rows.set(id, value);
                    return request(() => value);
                  },
                  delete(key: string) {
                    rows.delete(key);
                    return request(() => undefined);
                  },
                  getAll() {
                    return request(() => [...rows.values()]);
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
