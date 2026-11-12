import { describe, expect, it } from 'vitest';
import { MemoryDb } from '../mock/postgrest';

describe('MemoryDb PostgREST subset', () => {
  it('filters, orders, and limits', () => {
    const db = new MemoryDb(
      {
        clients: [
          { id: '2', name: 'B', created_at: '2026-01-02' },
          { id: '1', name: 'A', created_at: '2026-01-01' },
        ],
      },
      '2026-11-10T07:30:00.000Z',
    );
    const res = db.handle(
      'GET',
      'clients?select=id,name&order=name.asc&limit=1',
      null,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: '1', name: 'A' }]);
  });

  it('patches by eq filter', () => {
    const db = new MemoryDb(
      { inventory: [{ category_id: 'mint', stock: 5 }] },
      '2026-11-10T07:30:00.000Z',
    );
    const res = db.handle(
      'PATCH',
      'inventory?category_id=eq.mint',
      { stock: 8 },
      'return=representation',
    );
    expect(res.status).toBe(200);
    expect((res.body as Array<{ stock: number }>)[0]!.stock).toBe(8);
  });

  it('posts and assigns id', () => {
    const db = new MemoryDb({ clients: [] }, '2026-11-10T07:30:00.000Z');
    const res = db.handle('POST', 'clients', { name: 'Test' }, 'return=representation');
    expect(res.status).toBe(201);
    const row = (res.body as Array<{ name: string; id: string }>)[0]!;
    expect(row.name).toBe('Test');
    expect(row.id).toMatch(/^00000000-0000-4000-8000-/);
  });
});
