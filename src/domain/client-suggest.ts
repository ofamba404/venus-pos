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

/** Highlight the first case-insensitive occurrence of query in name. */
export function highlightMatches(name: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text: name, hit: false }];
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return [{ text: name, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  if (i > 0) parts.push({ text: name.slice(0, i), hit: false });
  parts.push({ text: name.slice(i, i + q.length), hit: true });
  if (i + q.length < name.length) parts.push({ text: name.slice(i + q.length), hit: false });
  return parts;
}

export function exactClientMatch(query: string, people: Person[]): Person | null {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  return people.find((p) => p.name.trim().toLowerCase() === key) || null;
}

/**
 * Chips under the Client field. An empty query shows recent people (latest sale first).
 * While typing, the same merge list is filtered and ranked, starts-with first.
 */
export function chipClients(query: string, people: Person[], limit = 8): ClientSuggestion[] {
  const q = query.trim();
  const source = q
    ? filterPeople(people, 'all', q)
    : [...people].sort((a, b) => {
        if (a.lastOrderAt !== b.lastOrderAt) return (b.lastOrderAt || '').localeCompare(a.lastOrderAt || '');
        return a.name.localeCompare(b.name);
      });
  if (q) {
    const lower = q.toLowerCase();
    source.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name);
    });
  }
  return source.slice(0, limit).map((person) => ({
    key: person.key,
    name: person.name,
    id: person.client?.id || '',
    phone: person.phone,
  }));
}
