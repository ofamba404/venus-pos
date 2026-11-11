import { idbClear, idbRead, idbWrite } from './store/idb.js';
import { STALE_MS } from './store/repository.js';

/** @deprecated Use dataStore — kept for gradual migration. */
export const FRESH_MS = STALE_MS.sales;

export async function readCache(key, maxAge = STALE_MS.sales) {
  const row = await idbRead(key, maxAge);
  return row?.data ?? null;
}

export async function readStaleCache(key) {
  const row = await idbRead(key, Infinity);
  return row?.data ?? null;
}

export async function writeCache(key, data) {
  await idbWrite(key, data);
}

export async function clearCache(key) {
  await idbClear(key);
}

export async function isCacheFresh(key) {
  const row = await idbRead(key, STALE_MS[key] ?? STALE_MS.sales);
  return row?.data != null;
}
