import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let handler: (path: string) => { ok: boolean; rows?: unknown };

vi.mock('../../src/data/api', () => ({
  sbFetch: async (path: string) => {
    calls.push(path);
    const out = handler(path);
    return { ok: out.ok, status: out.ok ? 200 : 500, json: async () => out.rows };
  },
}));

import { sbFetchAll } from '../../src/data/repository';

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));

describe('sbFetchAll', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('keeps asking for pages until one comes back short, so a capped response does not hide older rows', async () => {
    handler = (path) => {
      const offset = Number(/offset=(\d+)/.exec(path)![1]);
      return { ok: true, rows: offset === 0 ? rows(0, 3) : offset === 3 ? rows(3, 3) : rows(6, 1) };
    };
    const all = await sbFetchAll<{ id: string }>('sales?select=*&order=created_at.desc', 3);
    expect(all).toHaveLength(7);
    expect(calls).toEqual([
      'sales?select=*&order=created_at.desc&limit=3&offset=0',
      'sales?select=*&order=created_at.desc&limit=3&offset=3',
      'sales?select=*&order=created_at.desc&limit=3&offset=6',
    ]);
  });

  it('drops a row that shifted onto two pages, and starts a query string when there is none', async () => {
    handler = (path) => ({ ok: true, rows: /offset=0/.test(path) ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'b' }] });
    const all = await sbFetchAll<{ id: string }>('clients', 2);
    expect(all.map((r) => r.id)).toEqual(['a', 'b']);
    expect(calls[0]).toBe('clients?limit=2&offset=0');
  });

  it('throws on a failed page instead of returning part of the list, and stops on a non-array body', async () => {
    handler = () => ({ ok: false });
    await expect(sbFetchAll('sales', 2)).rejects.toThrow('Supabase 500');
    handler = () => ({ ok: true, rows: { error: 'x' } });
    expect(await sbFetchAll('sales', 2)).toEqual([]);
  });
});
