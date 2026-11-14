import { describe, expect, it } from 'vitest';
import { chipClients, clientPeople, exactClientMatch, highlightMatches, suggestClients } from '../../src/domain/client-suggest';
import { SELL_COOKIES, SELL_JOINTS } from '../../src/ui/ProductGrid';

describe('suggestClients', () => {
  const people = clientPeople(
    [
      { id: 'c1', name: 'Test Client A' },
      { id: 'c2', name: 'Client With Debt' },
    ],
    [
      { id: 'a1', snapchat_name: 'MangoStore', pos_display_name: 'Mango', phone_country_code: '256', phone_national: '700111222' },
    ],
  );

  it('suggests POS clients and storefront accounts by name', () => {
    const rows = suggestClients('tes', people);
    expect(rows.map((r) => r.name)).toContain('Test Client A');
    expect(rows.find((r) => r.name === 'Test Client A')?.id).toBe('c1');
  });

  it('matches a storefront alias or snapchat name', () => {
    const rows = suggestClients('mango', people);
    expect(rows.some((r) => r.name === 'Mango' || r.name === 'MangoStore')).toBe(true);
  });

  it('returns nothing until the cashier types', () => {
    expect(suggestClients('', people)).toEqual([]);
    expect(suggestClients('   ', people)).toEqual([]);
  });
});

describe('chipClients and highlights', () => {
  const people = clientPeople(
    [
      { id: 'c1', name: 'Test Client A' },
      { id: 'c2', name: 'Hellena' },
    ],
    [{ id: 'a1', snapchat_name: 'MangoStore', pos_display_name: 'Mango' }],
  );

  it('shows recent people when the field is empty', () => {
    const rows = chipClients('', people);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Test Client A', 'Hellena', 'Mango']));
  });

  it('filters and ranks starts-with matches while typing', () => {
    expect(chipClients('hel', people).map((r) => r.name)).toEqual(['Hellena']);
  });

  it('highlights the matched letters and detects an exact name', () => {
    expect(highlightMatches('Hellena', 'hel')).toEqual([
      { text: 'Hel', hit: true },
      { text: 'lena', hit: false },
    ]);
    expect(exactClientMatch('hellena', people)?.name).toBe('Hellena');
    expect(exactClientMatch('Hel', people)).toBeNull();
  });
});

describe('chipClients dedupe and storefront', () => {
  it('dedupes two walk-ins with the same name into one chip', () => {
    const people = clientPeople(
      [
        { id: 'c1', name: 'Test Client A' },
        { id: 'c2', name: 'Test Client A' },
      ],
      [],
    );
    expect(chipClients('Test', people).map((r) => r.name)).toEqual(['Test Client A']);
  });

  it('includes a storefront-only account while typing, next to a walk-in with the same prefix', () => {
    const people = clientPeople(
      [{ id: 'c1', name: 'Test Client A' }],
      [{ id: 'a1', snapchat_name: 'Test Storefront', phone_country_code: '256', phone_national: '701998877' }],
    );
    expect(chipClients('Test', people).map((r) => r.name).sort()).toEqual(['Test Client A', 'Test Storefront']);
    expect(chipClients('Test', people).find((r) => r.name === 'Test Storefront')?.id).toBe('');
  });
});

describe('Sell product groups', () => {
  it('lists 6 joint cards then 4 cookie cards', () => {
    expect(SELL_JOINTS).toHaveLength(6);
    expect(SELL_COOKIES).toHaveLength(4);
    expect(SELL_JOINTS.every((p) => !String(p.id).startsWith('cookie'))).toBe(true);
    expect(SELL_COOKIES.every((p) => String(p.id).startsWith('cookie'))).toBe(true);
  });
});
