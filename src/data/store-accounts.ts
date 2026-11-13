import { signal } from '@preact/signals';
import { sbFetch } from './api';
import { storeAuth } from './writes/store';
import type { PersonAccount } from '../domain/people';

export type StoreAccountRow = PersonAccount & { [key: string]: unknown };

export const storeAccounts = signal<StoreAccountRow[]>([]);

/** PostgREST page size. Pages are fetched until one comes back short, so every account loads. */
export const STORE_ACCOUNT_PAGE = 200;
const MAX_PAGES = 50;

/** One page-by-page read of the table. Only a fallback: the live table is not always readable straight from the app. */
async function loadStoreAccountsFromTable(): Promise<StoreAccountRow[]> {
  const all: StoreAccountRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await sbFetch(
      `store_accounts?select=*&order=id.asc&limit=${STORE_ACCOUNT_PAGE}&offset=${page * STORE_ACCOUNT_PAGE}`,
    );
    if (!res.ok) throw new Error(`Could not load storefront accounts (${res.status})`);
    const rows = (await res.json()) as StoreAccountRow[];
    all.push(...rows);
    if (rows.length < STORE_ACCOUNT_PAGE) break;
  }
  return all;
}

/**
 * Loads ALL storefront accounts for the Clients list. Like v1, this asks the store-auth admin action, which returns
 * every account whatever the table's row rules say. Reading the table straight from the app can come back empty on live
 * data, and then no one is tagged Storefront. The table read is the fallback.
 */
export async function loadStoreAccounts(): Promise<StoreAccountRow[]> {
  let rows: StoreAccountRow[] | null = null;
  try {
    const { ok, data } = await storeAuth('admin_list_users');
    const users = (data as { users?: unknown }).users;
    if (ok && Array.isArray(users)) rows = users as StoreAccountRow[];
  } catch {
    rows = null;
  }
  if (!rows) rows = await loadStoreAccountsFromTable();
  storeAccounts.value = rows;
  return rows;
}
