import { filterPeople, mergePeople, type Person, type PersonAccount, type PersonClient } from './people';

export type ClientSuggestion = {
  key: string;
  name: string;
  /** POS client id when this person has one. Storefront-only people leave it empty. */
  id: string;
  phone: string;
};

/** People the Client field can offer, from the same POS-client + store-account merge as the Clients page. */
export function clientPeople(clients: PersonClient[], accounts: PersonAccount[]): Person[] {
  return mergePeople(clients, accounts);
}

/**
 * Names that match what the cashier has typed. Starts-with matches sit first.
 * An empty query returns nothing: the list only appears while they are typing.
 */
export function suggestClients(query: string, people: Person[], limit = 8): ClientSuggestion[] {
  const q = query.trim();
  if (!q) return [];
  const matches = filterPeople(people, 'all', q);
  const lower = q.toLowerCase();
  matches.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.name.localeCompare(b.name);
  });
  return matches.slice(0, limit).map((person) => ({
    key: person.key,
    name: person.name,
    id: person.client?.id || '',
    phone: person.phone,
  }));
}
