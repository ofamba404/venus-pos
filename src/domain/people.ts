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
  /** The real store_accounts name column. Every account has it; only a few have a POS alias. */
  snapchat_name?: string | null;
  /** The real phone columns: a country code and the 9-digit national number. There is no `phone`. */
  phone_country_code?: string | null;
  phone_national?: string | null;
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

/** An account's number, whichever column the list used. store-auth admin_list_users returns phone_country_code + phone_national. */
function accountPhone(account: PersonAccount | null | undefined): string {
  if (!account) return '';
  const direct = String(account.phone || account.phone_e164 || '').trim();
  if (direct) return direct;
  const national = String(account.phone_national || '').replace(/\D/g, '');
  if (!national) return '';
  const cc = String(account.phone_country_code || '').replace(/\D/g, '');
  return cc ? `+${cc}${national}` : national;
}

/** The name staff know an account by: their POS alias, else the storefront (snapchat) name. */
function accountName(account: PersonAccount | null | undefined): string {
  return String(account?.pos_display_name || '').trim() || String(account?.snapchat_name || '').trim();
}

/** Lowercase, single-spaced. Walk-in clients carry no phone in the live table, so the name is the other way to match. */
export function nameKey(raw: string | null | undefined): string {
  return String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function personName(client: PersonClient | null, account: PersonAccount | null): string {
  const fromClient = String(client?.name || '').trim();
  if (fromClient) return fromClient;
  const fromAccount = accountName(account);
  if (fromAccount) return fromAccount;
  return String(client?.phone || accountPhone(account)).trim() || 'Client';
}

/** An account with no name and no number says nothing. A client with neither is junk too. */
function isEmptyAccount(account: PersonAccount): boolean {
  return !accountName(account) && !phoneKey(accountPhone(account));
}

/** The same storefront person twice (same number, or same name with no number to tell them apart): keep one row. */
export function dedupeAccounts(accounts: PersonAccount[]): PersonAccount[] {
  const byPhone = new Map<string, PersonAccount>();
  const byName = new Map<string, PersonAccount>();
  const out: PersonAccount[] = [];
  for (const account of accounts) {
    if (!account || isEmptyAccount(account)) continue;
    const pk = phoneKey(accountPhone(account));
    const nk = nameKey(accountName(account));
    const seen = (pk && byPhone.get(pk)) || (!pk && nk && byName.get(nk)) || null;
    if (seen) continue;
    if (pk) byPhone.set(pk, account);
    else if (nk) byName.set(nk, account);
    out.push(account);
  }
  return out;
}

export function mergePeople(
  clientRows: PersonClient[],
  accountRows: PersonAccount[],
  extras: {
    owedByClient?: Map<string, number>;
    lastOrderByClient?: Map<string, string>;
  } = {},
): Person[] {
  const owedBy = extras.owedByClient || new Map<string, number>();
  const lastBy = extras.lastOrderByClient || new Map<string, string>();
  const accounts = dedupeAccounts(accountRows);
  const clients = clientRows.filter((c) => c && (String(c.name || '').trim() || phoneKey(c.phone)));
  const accountByPhone = new Map<string, PersonAccount>();
  const accountByName = new Map<string, PersonAccount[]>();
  for (const account of accounts) {
    const key = phoneKey(accountPhone(account));
    if (key && !accountByPhone.has(key)) accountByPhone.set(key, account);
    for (const n of [account.pos_display_name, account.snapchat_name]) {
      const nk = nameKey(n);
      if (!nk) continue;
      const list = accountByName.get(nk) || [];
      if (!list.includes(account)) list.push(account);
      accountByName.set(nk, list);
    }
  }
  const used = new Set<string>();
  const people: Person[] = [];
  for (const client of clients) {
    const key = phoneKey(client.phone);
    // The number is the strong link. The live clients table has no phone column, so fall back to the same name.
    let account: PersonAccount | null = key ? accountByPhone.get(key) || null : null;
    if (account && used.has(account.id)) account = null;
    if (!account) {
      const nk = nameKey(client.name);
      account = (nk ? accountByName.get(nk) || [] : []).find((a) => !used.has(a.id)) || null;
    }
    // One account joins one client. A second client with the same phone or name stays a separate walk-in.
    if (account) used.add(account.id);
    people.push({
      key: `c:${client.id}`,
      name: personName(client, account),
      phone: String(client.phone || accountPhone(account)),
      client,
      account,
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
