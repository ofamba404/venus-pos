import { describe, expect, it } from 'vitest';
import { applyCachedEntity, inventory, inventoryReady, sales } from '../../src/data/entities';
import { resetFreshnessForTests, entityFetchedAt } from '../../src/data/freshness';
import { hydrateEntities } from '../../src/data/hydrate';
import { idbWrite, resetPosDbForTests } from '../../src/data/idb';
import { installFakeIndexedDb } from './fake-idb';

describe('boot hydrate from a v1 cache', () => {
  it('paints sales and inventory stored as { key, ts, data }', async () => {
    installFakeIndexedDb();
    resetPosDbForTests();
    resetFreshnessForTests();
    sales.value = [];
    inventoryReady.value = false;
    await idbWrite('sales', [{ id: 'v1-sale', total_ugx: 8000, created_at: '2026-11-10T07:00:00.000Z' }], 5000);
    await idbWrite(
      'inventory',
      [
        { category_id: 'mint', stock: 20 },
        { category_id: 'cookie', stock: 99 },
      ],
      5000,
    );

    const applied = await hydrateEntities((entity, data) => applyCachedEntity(entity, data));

    expect(applied.sort()).toEqual(['inventory', 'sales']);
    expect(sales.value.map((row) => row.id)).toEqual(['v1-sale']);
    expect(inventory.value.mint).toBe(20);
    expect(inventoryReady.value).toBe(true);
    expect(entityFetchedAt('sales')).toBe(5000);
    expect(entityFetchedAt('inventory')).toBe(5000);
  });
});
