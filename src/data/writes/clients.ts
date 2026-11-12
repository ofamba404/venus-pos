import { sbFetch } from '../api';

export function postClient(name: string) {
  return sbFetch('clients', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name }),
  });
}
