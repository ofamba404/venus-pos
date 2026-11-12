import { describe, expect, it } from 'vitest';
import {
  QUERIES,
  STALE_MS,
  inventoryMapFromRows,
  keepCachedRows,
  mergeSalesRows,
} from '../../src/data/repository';
import { isFresh, markFetched, resetFreshnessForTests } from '../../src/data/freshness';
import { shouldSkipPrefetch, staleEntities } from '../../src/data/prefetch';
import { inventoryDeltaBody, inventoryPatchBody, inventoryPatchPath } from '../../src/data/writes/inventory';
import { storeOrderCheckedOutBody, storeOrderPatchPath } from '../../src/data/writes/store-orders';

describe('repository', () => {
  it('keeps v1 stale windows and sales queries', () => {
    expect(STALE_MS).toEqual({
      sales: 15 * 60_000,
      inventory: 20_000,
      clients: 30 * 60_000,
      deliveries: 15 * 60_000,
    });
    expect(QUERIES.salesRecent).toBe('sales?select=*&order=created_at.desc&limit=2000');
    expect(QUERIES.salesOpenCredit).toBe(
      'sales?is_credit=eq.true&credit_cleared=eq.false&select=*&order=created_at.desc',
    );
    expect(QUERIES.inventory).toBe('inventory?select=category_id,stock');
  });

  it('merges open credit that is outside the recent page', () => {
    const recent = [{ id: 'a', created_at: '2026-11-10T10:00:00.000Z' }];
    const open = [
      { id: 'a', created_at: '2026-11-10T10:00:00.000Z' },
      { id: 'old', created_at: '2026-01-01T00:00:00.000Z' },
    ];
    expect(mergeSalesRows(recent, open).map((row) => row.id)).toEqual(['a', 'old']);
  });

  it('applies v1 inventory rows and drops the shared cookie alias', () => {
    const { map, applied } = inventoryMapFromRows([
      { category_id: 'mint', stock: 20.9 },
      { category_id: 'cookie', stock: 9 },
      { category_id: 'nope', stock: 4 },
    ]);
    expect(applied).toBe(1);
    expect(map.mint).toBe(20);
    expect(map.cookie_butterscotch).toBe(0);
  });

  it('keeps a non-empty cache when the server returns nothing', () => {
    expect(keepCachedRows([], true)).toBe(true);
    expect(keepCachedRows([], true, true)).toBe(false);
    expect(keepCachedRows([{ id: 'a' }], true)).toBe(false);
  });

  it('treats a snapshot as fresh only inside its window', () => {
    resetFreshnessForTests();
    const now = 1_000_000;
    markFetched('inventory', now - 19_000);
    expect(isFresh('inventory', now)).toBe(true);
    markFetched('inventory', now - 21_000);
    expect(isFresh('inventory', now)).toBe(false);
    expect(isFresh('sales', now)).toBe(false);
  });
});

describe('prefetch and writes', () => {
  it('skips idle prefetch on Save-Data and 2G', () => {
    expect(shouldSkipPrefetch(null)).toBe(false);
    expect(shouldSkipPrefetch({ saveData: true })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: '2g' })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: '4g' })).toBe(false);
  });

  it('lists only stale entities', () => {
    expect(staleEntities((name) => name === 'sales')).toEqual(['inventory', 'clients', 'deliveries']);
  });

  it('builds the inventory fallback and store-order checkout writes', () => {
    expect(inventoryDeltaBody('mint', -1)).toEqual({ op: 'delta', category_id: 'mint', delta: -1 });
    expect(inventoryPatchPath('mint')).toBe('inventory?category_id=eq.mint');
    expect(inventoryPatchBody(21)).toEqual({ stock: 21 });
    expect(storeOrderPatchPath('a b')).toBe('store_orders?id=eq.a%20b');
    expect(storeOrderCheckedOutBody('sale-1')).toEqual({ status: 'checked_out', sale_id: 'sale-1' });
  });
});
