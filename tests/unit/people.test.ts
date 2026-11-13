import { describe, expect, it } from 'vitest';
import { filterCounts, filterPeople, matchesFilter, mergePeople, personMeta, phoneKey } from '../../src/domain/people';

const clients = [
  { id: 'c1', name: 'Grace', phone: '0700333444' },
  { id: 'c2', name: 'Walk In', phone: null },
  { id: 'c3', name: 'Debtor', phone: '0772111222' },
  { id: 'c4', name: 'Twin', phone: '700333444' },
];
const accounts = [
  { id: 'a1', phone: '+256700333444', pos_display_name: 'Grace Store', verified: true },
  { id: 'a2', phone: '0700999000', pos_display_name: null, verified: false },
];

describe('phoneKey', () => {
  it('compares the 9-digit local form', () => {
    expect(phoneKey('0700333444')).toBe('700333444');
    expect(phoneKey('+256 700 333 444')).toBe('700333444');
    expect(phoneKey('256700333444')).toBe('700333444');
    expect(phoneKey('12345')).toBe('');
    expect(phoneKey(null)).toBe('');
  });
});

describe('mergePeople', () => {
  const people = mergePeople(clients, accounts, { owedByClient: new Map([['c3', 15000]]) });

  it('shows a client and an account with the same phone as ONE person with both action sets', () => {
    const grace = people.find((p) => p.client?.id === 'c1')!;
    expect(grace.account?.id).toBe('a1');
    expect(grace.name).toBe('Grace');
    expect(people.filter((p) => p.account?.id === 'a1')).toHaveLength(1);
  });

  it('keeps a second client with the same phone as its own walk-in', () => {
    const twin = people.find((p) => p.client?.id === 'c4')!;
    expect(twin.account).toBeNull();
  });

  it('lists an account with no matching client as a store-only person', () => {
    const only = people.find((p) => p.account?.id === 'a2')!;
    expect(only.client).toBeNull();
    expect(only.name).toBe('0700999000');
  });

  it('never matches on a missing or short phone', () => {
    const none = mergePeople([{ id: 'x', name: 'X', phone: null }], [{ id: 'y', phone: '', snapchat_name: 'Y Store' }]);
    expect(none).toHaveLength(2);
    expect(none.find((p) => p.client)!.account).toBeNull();
  });

  it('counts and filters: All, Walk-in, Storefront, Owes money', () => {
    expect(filterCounts(people)).toEqual({ all: 5, walkin: 3, storefront: 2, owes: 1 });
    expect(filterPeople(people, 'walkin', '').map((p) => p.name).sort()).toEqual(['Debtor', 'Twin', 'Walk In']);
    expect(filterPeople(people, 'storefront', '').map((p) => p.key).sort()).toEqual(['a:a2', 'c:c1']);
    expect(filterPeople(people, 'owes', '').map((p) => p.name)).toEqual(['Debtor']);
    expect(matchesFilter(people[0]!, 'all')).toBe(true);
  });

  it('searches by name and by phone in any format', () => {
    expect(filterPeople(people, 'all', 'grac').map((p) => p.name)).toEqual(['Grace']);
    expect(filterPeople(people, 'all', '+256 772 111').map((p) => p.name)).toEqual(['Debtor']);
  });
});

describe('personMeta', () => {
  it('has better copy than "Last order No orders yet"', () => {
    const [grace, walk] = mergePeople(clients, [], {
      lastOrderByClient: new Map([['c1', '2026-11-06T10:00:00Z']]),
    });
    expect(personMeta(grace!)).toBe('0700333444 · Last bought 6 Nov');
    expect(personMeta(walk!)).toBe('No sales yet');
    expect(personMeta(mergePeople([], [accounts[1]!])[0]!)).toBe('0700999000 · Not verified');
  });
});

describe('real-shaped storefront accounts (store-auth admin_list_users)', () => {
  // Anonymised rows with the live column names: snapchat_name, pos_display_name, phone_country_code, phone_national.
  const real = [
    { id: 'r1', snapchat_name: 'Alpha One', pos_display_name: null, phone_country_code: '+256', phone_national: '700111222', verified: true },
    { id: 'r2', snapchat_name: 'beta  two', pos_display_name: 'Beta Alias', phone_country_code: '+256', phone_national: '', verified: false },
    { id: 'r3', snapchat_name: '_J_', pos_display_name: null, phone_country_code: '+256', phone_national: '', verified: true },
    { id: 'r4', snapchat_name: 'Alpha One', pos_display_name: null, phone_country_code: '+256', phone_national: '700111222', verified: true },
    { id: 'r5', snapchat_name: '', pos_display_name: null, phone_country_code: '+256', phone_national: '', verified: false },
    { id: 'r6', snapchat_name: 'Gamma', pos_display_name: null, phone_country_code: '+256', phone_national: '', verified: true },
  ];
  // The live clients table has no phone column.
  const walkIns = [
    { id: 'k1', name: 'Gamma' },
    { id: 'k2', name: 'Delta Walkin' },
    { id: 'k3', name: 'Owes A Lot' },
    { id: 'k4', name: '' },
  ];
  const people = mergePeople(walkIns, real, { owedByClient: new Map([['k3', 9000]]) });

  it('names an account by its snapchat name and builds its phone from the country code and national number', () => {
    const alpha = people.find((p) => p.account?.id === 'r1')!;
    expect(alpha.name).toBe('Alpha One');
    expect(alpha.phone).toBe('+256700111222');
    expect(personMeta(alpha)).toBe('+256700111222 · Verified');
    expect(people.some((p) => p.name === 'Client')).toBe(false);
  });

  it('prefers the POS alias when there is one', () => {
    expect(people.find((p) => p.account?.id === 'r2')!.name).toBe('Beta Alias');
  });

  it('drops empty accounts and empty clients, and dedupes the same number', () => {
    expect(people.find((p) => p.account?.id === 'r5')).toBeUndefined();
    expect(people.find((p) => p.client?.id === 'k4')).toBeUndefined();
    expect(people.filter((p) => p.account?.id === 'r1' || p.account?.id === 'r4')).toHaveLength(1);
  });

  it('joins a walk-in to its account by name when the client has no phone', () => {
    const gamma = people.find((p) => p.client?.id === 'k1')!;
    expect(gamma.account?.id).toBe('r6');
    expect(people.filter((p) => p.account?.id === 'r6')).toHaveLength(1);
  });

  it('All / Walk-in / Storefront / Owes each filter the real-shaped list', () => {
    const counts = filterCounts(people);
    expect(counts.all).toBe(people.length);
    expect(filterPeople(people, 'walkin', '').map((p) => p.name).sort()).toEqual(['Delta Walkin', 'Owes A Lot']);
    expect(filterPeople(people, 'storefront', '').map((p) => p.name).sort()).toEqual(['Alpha One', 'Beta Alias', 'Gamma', '_J_']);
    expect(filterPeople(people, 'owes', '').map((p) => p.name)).toEqual(['Owes A Lot']);
    expect(filterPeople(people, 'all', '700111222')).toHaveLength(1);
  });
});
