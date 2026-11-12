import { sbFetch } from '../api';

export function postDelivery(body: Record<string, unknown>) {
  return sbFetch('deliveries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
}

export function deliveryByIdPath(id: string) {
  return `deliveries?id=eq.${encodeURIComponent(id)}`;
}

export function patchDelivery(id: string, body: unknown) {
  return sbFetch(deliveryByIdPath(id), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
}
