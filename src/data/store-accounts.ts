import { signal } from '@preact/signals';
import { sbFetch } from './api';
import type { PersonAccount } from '../domain/people';

export type StoreAccountRow = PersonAccount & { [key: string]: unknown };

export const storeAccounts = signal<StoreAccountRow[]>([]);

/** PostgREST page size. Pages are fetched until one comes back short, so every account loads. */
export const STORE_ACCOUNT_PAGE = 200;
const MAX_PAGES = 50;

/** Loads ALL storefront accounts, a page at a time. The Clients list merges them with POS clients. */
export async function loadStoreAccounts(): Promise<StoreAccountRow[]> {
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
  storeAccounts.value = all;
  return all;
}
