import { sbFetch } from '../api';

export function postDelivery(body: Record<string, unknown>) {
  return sbFetch('deliveries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
}
