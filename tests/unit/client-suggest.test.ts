import { describe, expect, it } from 'vitest';
import { clientPeople, suggestClients } from '../../src/domain/client-suggest';

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
