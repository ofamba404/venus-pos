import { idbRead } from './idb';
import { markFetched } from './freshness';
import { ENTITIES, type EntityName } from './repository';

export type HydrateApply = (entity: EntityName, data: unknown, ts: number) => void;

/**
 * Read v1 cache rows (`{ key, ts, data }`) and hand them to the caller.
 * Missing keys are skipped. A thrown IndexedDB leaves the signals untouched.
 */
export async function hydrateEntities(apply: HydrateApply): Promise<EntityName[]> {
  const applied: EntityName[] = [];
  await Promise.all(
    ENTITIES.map(async (entity) => {
      const row = await idbRead(entity);
      if (!row || row.data == null) return;
      apply(entity, row.data, row.ts);
      markFetched(entity, row.ts);
      applied.push(entity);
    }),
  );
  return applied;
}
