import { sbFetch } from '../api';

export const SALE_INSERT_PATH = 'sales';

export function postSale(body: unknown) {
  return sbFetch(SALE_INSERT_PATH, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
}

export function saleByIdPath(id: string) {
  return `sales?id=eq.${encodeURIComponent(id)}`;
}

export function patchSale(id: string, body: unknown, prefer?: string) {
  return sbFetch(saleByIdPath(id), {
    method: 'PATCH',
    ...(prefer ? { headers: { Prefer: prefer } } : {}),
    body: JSON.stringify(body),
  });
}

export function deleteSale(id: string) {
  return sbFetch(saleByIdPath(id), {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}
