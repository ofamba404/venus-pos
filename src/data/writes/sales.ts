import { sbFetch } from '../api';

export const SALE_INSERT_PATH = 'sales';

export function postSale(body: unknown) {
  return sbFetch(SALE_INSERT_PATH, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
}
