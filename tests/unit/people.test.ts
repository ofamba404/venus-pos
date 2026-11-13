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
    const none = mergePeople([{ id: 'x', name: 'X', phone: null }], [{ id: 'y', phone: '' }]);
    expect(none).toHaveLength(2);
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
