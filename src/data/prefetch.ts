import { ENTITIES, type EntityName } from './repository';

export const PREFETCH_ORDER: EntityName[] = ['inventory', 'clients', 'deliveries', 'sales'];

export type ConnectionHint = { saveData?: boolean; effectiveType?: string };

/** Skip idle work on Save-Data or 2G. Missing connection info does not skip. */
export function shouldSkipPrefetch(connection?: ConnectionHint | null): boolean {
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

export function staleEntities(
  fresh: (entity: EntityName) => boolean,
  order: readonly EntityName[] = PREFETCH_ORDER,
): EntityName[] {
  return order.filter((entity) => ENTITIES.includes(entity) && !fresh(entity));
}

export function scheduleIdlePrefetch(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => run(), { timeout: 2500 });
    return () => cancelIdleCallback(id);
  }
  const timer = setTimeout(run, 120);
  return () => clearTimeout(timer);
}

export function readConnection(): ConnectionHint | null {
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  return nav.connection || null;
}
