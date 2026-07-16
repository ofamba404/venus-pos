import { showToast } from '../utils.js';
import { clients, deliveries, draftStock, inventory, salesCache } from '../state.js';
import { idbClear, idbReadStale, idbWrite } from './idb.js';
import {
  ENTITIES,
  STALE_MS,
  applyClients,
  applyDeliveries,
  applyInventoryRows,
  applySales,
  fetchEntityFromNetwork,
  hasEntityData,
  inventoryRowsFromState,
} from './repository.js';

const listeners = new Map();
ENTITIES.forEach((e) => listeners.set(e, new Set()));

const meta = new Map();
ENTITIES.forEach((e) => meta.set(e, { ts: 0, hydrated: false, fetching: false, error: null }));

const inFlight = new Map();

function stateRef() {
  return { salesCache, inventory, clients, deliveries };
}

function applyEntity(entity, data) {
  switch (entity) {
    case 'sales':
      applySales(salesCache, data);
      break;
    case 'inventory':
      applyInventoryRows(inventory, draftStock, data);
      break;
    case 'clients':
      applyClients(clients, data);
      break;
    case 'deliveries':
      applyDeliveries(deliveries, data);
      break;
    default:
      break;
  }
}

function serializeEntity(entity) {
  switch (entity) {
    case 'inventory':
      return inventoryRowsFromState(inventory);
    default:
      // Copy so persist → applyEntity cannot wipe the live cache
      // when rows and the target array are the same reference.
      return [...get(entity)];
  }
}

function notify(entity) {
  listeners.get(entity)?.forEach((fn) => {
    try {
      fn(getStatus(entity));
    } catch (e) {
      console.error(`DataStore listener error (${entity})`, e);
    }
  });
}

function setMeta(entity, patch) {
  meta.set(entity, { ...meta.get(entity), ...patch });
}

export function get(entity) {
  switch (entity) {
    case 'sales':
      return salesCache;
    case 'inventory':
      return inventory;
    case 'clients':
      return clients;
    case 'deliveries':
      return deliveries;
    default:
      return null;
  }
}

export function getStatus(entity) {
  const m = meta.get(entity) ?? { ts: 0, hydrated: false, fetching: false, error: null };
  return {
    ...m,
    hasData: hasEntityData(entity, stateRef()),
    fresh: m.ts > 0 && Date.now() - m.ts < (STALE_MS[entity] ?? 0),
  };
}

export function isFresh(entity) {
  return getStatus(entity).fresh;
}

export function hasData(entity) {
  return hasEntityData(entity, stateRef());
}

export function subscribe(entity, listener) {
  if (!listeners.has(entity)) listeners.set(entity, new Set());
  listeners.get(entity).add(listener);
  return () => listeners.get(entity)?.delete(listener);
}

export async function hydrate(entities = ENTITIES) {
  const result = {};
  await Promise.all(
    entities.map(async (entity) => {
      const row = await idbReadStale(entity);
      if (row?.data != null) {
        applyEntity(entity, row.data);
        setMeta(entity, { ts: row.ts, hydrated: true, error: null });
        result[entity] = hasEntityData(entity, stateRef());
      } else {
        setMeta(entity, { hydrated: true });
        result[entity] = false;
      }
      notify(entity);
    }),
  );
  return result;
}

export async function persist(entity, data) {
  applyEntity(entity, data);
  const ts = Date.now();
  await idbWrite(entity, data);
  setMeta(entity, { ts, hydrated: true, error: null });
  notify(entity);
}

export async function persistCurrent(entity) {
  await persist(entity, serializeEntity(entity));
}

export async function invalidate(entity) {
  setMeta(entity, { ts: 0 });
  return fetchEntity(entity, { force: true, trustEmpty: true });
}

export async function fetchEntity(entity, { force = false, silent = false, trustEmpty = false } = {}) {
  if (!ENTITIES.includes(entity)) return { entity, ok: false };

  if (!force && isFresh(entity)) {
    return { entity, ok: true, skipped: true };
  }

  if (inFlight.has(entity)) return inFlight.get(entity);

  const hadData = hasEntityData(entity, stateRef());
  setMeta(entity, { fetching: true, error: null });
  notify(entity);

  const work = (async () => {
    try {
      const rows = await fetchEntityFromNetwork(entity);
      const hadRows = hasEntityData(entity, stateRef());
      if (!rows.length && hadRows && entity !== 'inventory' && !trustEmpty) {
        console.warn(`fetch ${entity} returned empty while cache had data — keeping cache`);
        setMeta(entity, { ts: Date.now(), error: new Error('Empty response') });
        return { entity, ok: false, error: new Error('Empty response') };
      }
      await persist(entity, rows);
      return { entity, ok: true };
    } catch (e) {
      console.error(`fetch ${entity} failed`, e);
      setMeta(entity, { error: e });
      if (!silent && !hadData && !hasEntityData(entity, stateRef())) {
        const labels = {
          sales: 'sales',
          inventory: 'inventory',
          clients: 'clients',
          deliveries: 'delivery history',
        };
        showToast(`Could not load ${labels[entity] ?? entity} — check connection`, true);
      }
      return { entity, ok: false, error: e };
    } finally {
      setMeta(entity, { fetching: false });
      notify(entity);
      inFlight.delete(entity);
    }
  })();

  inFlight.set(entity, work);
  return work;
}

export async function fetchAll(entities = ENTITIES, { force = false, silent = false } = {}) {
  const results = await Promise.allSettled(
    entities.map((entity) => fetchEntity(entity, { force, silent })),
  );
  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { entity: entities[i], ok: false, error: r.reason },
  );
}

export async function clearEntity(entity) {
  await idbClear(entity);
  switch (entity) {
    case 'sales':
      salesCache.length = 0;
      break;
    case 'inventory':
      Object.keys(inventory).forEach((k) => {
        inventory[k] = 0;
        draftStock[k] = 0;
      });
      break;
    case 'clients':
      clients.length = 0;
      break;
    case 'deliveries':
      deliveries.length = 0;
      break;
    default:
      break;
  }
  setMeta(entity, { ts: 0, error: null });
  notify(entity);
}

/** Append a single sale after checkout POST (avoids full sales refetch). */
export async function appendSale(record) {
  if (!record) return;
  salesCache.unshift(record);
  await persistCurrent('sales');
}

/** Append or upsert a single delivery after checkout POST. */
export async function appendDelivery(record) {
  if (!record) return;
  deliveries.unshift(record);
  await persistCurrent('deliveries');
}

export async function recoverFromServer(entities = ENTITIES) {
  return fetchAll(entities, { force: true, silent: false });
}

export const dataStore = {
  ENTITIES,
  STALE_MS,
  get,
  getStatus,
  isFresh,
  hasData,
  subscribe,
  hydrate,
  persist,
  persistCurrent,
  invalidate,
  fetch: fetchEntity,
  fetchAll,
  clear: clearEntity,
  appendSale,
  appendDelivery,
  recoverFromServer,
};

export { ENTITIES, STALE_MS };
