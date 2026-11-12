import { sbFetch } from '../api';

export function postClient(name: string) {
  return sbFetch('clients', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name }),
  });
}

export function clientByIdPath(id: string) {
  return `clients?id=eq.${encodeURIComponent(id)}`;
}

export function patchClient(id: string, body: unknown) {
  return sbFetch(clientByIdPath(id), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteClient(id: string) {
  return sbFetch(clientByIdPath(id), { method: 'DELETE' });
}
