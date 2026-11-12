import { describe, expect, it } from 'vitest';
import { KEYS } from '../../src/data/keys';
import { idbRead, idbWrite, resetPosDbForTests } from '../../src/data/idb';
import { installFakeIndexedDb } from './fake-idb';

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
