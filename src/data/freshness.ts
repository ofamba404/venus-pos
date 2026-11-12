import { STALE_MS, type EntityName } from './repository';

const fetchedAt: Record<EntityName, number | null> = {
  sales: null,
  inventory: null,
  clients: null,
  deliveries: null,
};

/** Last successful snapshot time. Inventory local edits must not call this. */
export function markFetched(entity: EntityName, ts: number) {
  fetchedAt[entity] = ts;
}

export function entityFetchedAt(entity: EntityName): number | null {
  return fetchedAt[entity];
}

export function isFresh(entity: EntityName, now = Date.now()): boolean {
  const ts = fetchedAt[entity];
  if (!ts) return false;
  return now - ts < STALE_MS[entity];
}

export function resetFreshnessForTests() {
  (Object.keys(fetchedAt) as EntityName[]).forEach((name) => {
    fetchedAt[name] = null;
  });
}
