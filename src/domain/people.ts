import { localPhoneDigits } from './phone';

/**
 * One Clients list for two kinds of record: POS clients (walk-ins, credit) and storefront accounts.
 * A client and an account that share a 9-digit phone number are shown as ONE person. This is UI-only matching:
 * nothing is written to link them.
 */
export type PersonClient = { id: string; name?: string | null; phone?: string | null };
export type PersonAccount = {
  id: string;
  phone?: string | null;
  /** Some account lists name the number this way. */
  phone_e164?: string | null;
  pos_display_name?: string | null;
  verified?: boolean;
};

export type Person = {
  key: string;
  name: string;
  /** Phone as stored, preferring the POS client's. */
  phone: string;
  client: PersonClient | null;
  account: PersonAccount | null;
  owed: number;
  /** ISO timestamp of the latest sale, or ''. */
  lastOrderAt: string;
};

export type PersonFilter = 'all' | 'walkin' | 'storefront' | 'owes';

/** The 9-digit local form, or '' when the number is not a full Uganda mobile. */
export function phoneKey(raw: string | null | undefined): string {
  const digits = localPhoneDigits(raw);
  return digits.length === 9 ? digits : '';
}

/** An account's number, whichever column the list used. */
function accountPhone(account: PersonAccount | null | undefined): string {
  return String(account?.phone || account?.phone_e164 || '');
}

export function personName(client: PersonClient | null, account: PersonAccount | null): string {
  const fromClient = String(client?.name || '').trim();
  if (fromClient) return fromClient;
  const fromAccount = String(account?.pos_display_name || '').trim();
  if (fromAccount) return fromAccount;
  return String(client?.phone || accountPhone(account)).trim() || 'Client';
}

export function mergePeople(
  clients: PersonClient[],
  accounts: PersonAccount[],
  extras: {
    owedByClient?: Map<string, number>;
    lastOrderByClient?: Map<string, string>;
  } = {},
): Person[] {
  const owedBy = extras.owedByClient || new Map<string, number>();
  const lastBy = extras.lastOrderByClient || new Map<string, string>();
  const accountByPhone = new Map<string, PersonAccount>();
  for (const account of accounts) {
    const key = phoneKey(accountPhone(account));
    if (key && !accountByPhone.has(key)) accountByPhone.set(key, account);
  }
  const used = new Set<string>();
  const people: Person[] = [];
  for (const client of clients) {
    const key = phoneKey(client.phone);
    const account = key ? accountByPhone.get(key) || null : null;
    // One account joins one client. A second client with the same phone stays a separate walk-in.
    const joined = account && !used.has(account.id) ? account : null;
    if (joined) used.add(joined.id);
    people.push({
      key: `c:${client.id}`,
      name: personName(client, joined),
      phone: String(client.phone || accountPhone(joined)),
      client,
      account: joined,
      owed: owedBy.get(client.id) || 0,
      lastOrderAt: lastBy.get(client.id) || '',
    });
  }
  for (const account of accounts) {
    if (used.has(account.id)) continue;
    people.push({
      key: `a:${account.id}`,
      name: personName(null, account),
      phone: accountPhone(account),
      client: null,
      account,
      owed: 0,
      lastOrderAt: '',
    });
  }
  return people;
}

export function matchesFilter(person: Person, filter: PersonFilter): boolean {
  if (filter === 'walkin') return Boolean(person.client) && !person.account;
  if (filter === 'storefront') return Boolean(person.account);
  if (filter === 'owes') return person.owed > 0;
  return true;
}

export function filterPeople(people: Person[], filter: PersonFilter, query: string): Person[] {
  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  return people.filter((person) => {
    if (!matchesFilter(person, filter)) return false;
    if (!q) return true;
    if (person.name.toLowerCase().includes(q)) return true;
    if (qDigits.length >= 3 && localPhoneDigits(person.phone).includes(localPhoneDigits(qDigits))) return true;
    return false;
  });
}

export function filterCounts(people: Person[]): Record<PersonFilter, number> {
  return {
    all: people.length,
    walkin: people.filter((p) => matchesFilter(p, 'walkin')).length,
    storefront: people.filter((p) => matchesFilter(p, 'storefront')).length,
    owes: people.filter((p) => matchesFilter(p, 'owes')).length,
  };
}

/** Short, human line under the name. Never reads "Last order No orders yet". */
export function personMeta(person: Person): string {
  const parts: string[] = [];
  if (person.phone) parts.push(person.phone);
  if (person.lastOrderAt) {
    const when = new Date(person.lastOrderAt);
    if (!Number.isNaN(when.getTime())) {
      parts.push(`Last bought ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
    }
  } else if (person.client) {
    parts.push('No sales yet');
  } else if (person.account) {
    parts.push(person.account.verified ? 'Verified' : 'Not verified');
  }
  return parts.join(' · ');
}
