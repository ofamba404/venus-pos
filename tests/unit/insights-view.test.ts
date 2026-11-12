import { afterEach, describe, expect, it, vi } from 'vitest';
import { kampalaInputToIso, kampalaLocalInput } from '../../src/domain/kampala-time';
import {
  creditAging,
  flavorMix,
  historyOrDefault,
  jointCommission,
  productBars,
  topClients,
} from '../../src/domain/insights-view';
import { productImageSrc } from '../../src/domain/product-art';
import { localPhoneDigits } from '../../src/domain/phone';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('local phone copy', () => {
  it('keeps the 9-digit Uganda number', () => {
    expect(localPhoneDigits('+256772244956')).toBe('772244956');
    expect(localPhoneDigits('0772244956')).toBe('772244956');
    expect(localPhoneDigits('772244956')).toBe('772244956');
    expect(localPhoneDigits(null)).toBe('');
    expect(localPhoneDigits(undefined)).toBe('');
  });
});

describe('Kampala datetime', () => {
  it('shows the owner ISO instant as Kampala wall time', () => {
    expect(kampalaLocalInput('2026-11-12T14:53:32.075Z')).toBe('2026-11-12T17:53');
    expect(kampalaLocalInput('')).toBe('');
    expect(kampalaLocalInput('not-a-date')).toBe('');
    expect(kampalaLocalInput('2026-11-12T17:53')).toBe('2026-11-12T17:53');
  });

  it('stores a picker value as the same Kampala instant', () => {
    expect(kampalaInputToIso('2026-11-12T17:53')).toBe('2026-11-12T17:53:00+03:00');
    expect(kampalaInputToIso('2026-11-12T17:53:30')).toBe('2026-11-12T17:53:30+03:00');
    expect(kampalaInputToIso('')).toBe('');
    expect(kampalaInputToIso('nope')).toBe('');
    expect(kampalaInputToIso('not-a-dateZ')).toBe('');
    expect(kampalaInputToIso('2026-11-12T14:53:00.000Z')).toBe('2026-11-12T14:53:00.000Z');
  });
});

describe('insight boards', () => {
  const sales = [
    {
      id: 'a',
      client_id: 'c1',
      created_at: '2026-11-10T10:00:00.000Z',
      is_credit: true,
      credit_cleared: false,
      total_ugx: 8000,
      amount_paid_ugx: 0,
      items: [{ product_name: 'Scout Pack', line_total: 8000, breakdown: { mint: 1, mystery: 0 } }],
    },
    {
      id: 'b',
      client_id: 'c1',
      created_at: '2026-10-01T10:00:00.000Z',
      is_credit: true,
      credit_cleared: false,
      total_ugx: 5000,
      amount_paid_ugx: 1000,
      items: [{ product_name: '', line_total: 5000, is_reward: true, breakdown: { classic: 1 } }],
    },
    {
      id: 'c',
      client_id: '',
      created_at: '2026-09-01T10:00:00.000Z',
      total_ugx: 15000,
      items: [{ product_name: 'Cookie Duet', line_total: 15000, breakdown: { cookie_mint: 2, nope: 2 } }],
    },
    {
      id: 'd',
      client_id: 'c2',
      created_at: '2026-11-01T10:00:00.000Z',
      is_credit: true,
      credit_cleared: false,
      total_ugx: 4000,
      amount_paid_ugx: 0,
      items: [{ product_name: 'Scout Pack', line_total: 1000, breakdown: { mint: 1 } }],
    },
  ];

  it('mixes flavours, products, aging, and clients', () => {
    expect(flavorMix(null)).toEqual([]);
    expect(flavorMix([{ items: [{ breakdown: { mint: 2, grape: 2 } }] }]).map((row) => row.id)).toEqual([
      'grape',
      'mint',
    ]);
    expect(
      productBars([
        { items: [{ product_name: 'A', line_total: 1000 }, { product_name: 'B' }] },
        { items: [{ product_name: 'B', line_total: 1000 }] },
      ]).map((row) => row.name),
    ).toEqual(['B', 'A']);
    expect(creditAging(null)).toHaveLength(3);
    expect(flavorMix(sales).find((row) => row.id === 'mint')).toMatchObject({ name: 'Mint', qty: 2 });
    expect(productBars(sales).some((row) => row.name === 'Unknown')).toBe(true);
    const aging = creditAging(sales, new Date('2026-11-12T00:00:00.000Z'));
    expect(aging.map((row) => row.count)).toEqual([1, 1, 1]);
    expect(topClients(sales, [{ id: 'c1', name: null }]).map((row) => row.id)).toContain('c1');
    expect(topClients(null, null)).toEqual([]);
    const tied = topClients(
      [
        { client_id: 'b', items: [{ line_total: 1000, breakdown: { classic: 1 } }] },
        { client_id: 'a', items: [{ line_total: 1000, breakdown: { classic: 1 } }] },
      ],
      [
        { id: 'b', name: 'Zoe' },
        { id: 'a', name: 'Amy' },
      ],
    );
    expect(tied.map((row) => row.id)).toEqual(['a', 'b']);
    expect(
      creditAging([{ is_credit: true, credit_cleared: false }], new Date('2026-11-12T00:00:00.000Z'))[2]?.count,
    ).toBe(1);
    expect(productBars(null)).toEqual([]);
    expect(flavorMix(sales).find((row) => row.id === 'nope')?.name).toBe('nope');
    expect(historyOrDefault([{ category_id: 'mint', cost_ugx: 1000, effective_from: '1970-01-01T00:00:00.000Z' }])).toHaveLength(1);
  });

  it('ignores rewards, cookies, and a zero rate', () => {
    const none = jointCommission(sales, [], 0);
    expect(none.commission).toBe(0);
    const loss = jointCommission(
      [
        {
          items: [
            { breakdown: { mint: 1 } },
            { breakdown: { mint: 0, cookie_mint: 1, nope: 1, classic: 'bad' } },
            { is_reward: true },
            {},
          ],
        },
        { items: null },
      ],
      null,
    );
    expect(loss.profit).toBe(0);
    expect(jointCommission(null, null).commission).toBe(0);
    expect(productImageSrc('pilot')).toContain('assets/products/bestsellers-pilot-pack.webp');
    expect(productImageSrc('cookie_quartet')).toBe('');
    expect(productImageSrc('cookie_single', { cookie_mint: 2 })).toContain('mint-cookie.webp');
    vi.stubEnv('BASE_URL', '/next');
    expect(productImageSrc('scout')).toContain('/next/assets/products/scout-pack.webp');
    vi.stubEnv('BASE_URL', '');
    expect(productImageSrc('scout')).toContain('/assets/products/scout-pack.webp');
  });
});

describe('staff commission from joint cost history', () => {
  it('uses 4,000 after the cost change and skips unpaid credit', () => {
    const after = jointCommission(
      [
        {
          created_at: '2026-11-12T10:00:00.000Z',
          is_credit: false,
          items: [{ line_total: 8000, breakdown: { mint: 1 } }],
        },
      ],
      [],
    );
    expect(after).toMatchObject({ profit: 4000, commission: 1600, rate: 0.4 });

    const before = jointCommission(
      [
        {
          created_at: '2026-11-01T10:00:00.000Z',
          items: [{ line_total: 8000, breakdown: { mint: 1 } }],
        },
      ],
      [],
    );
    expect(before.profit).toBe(3000);

    const credit = jointCommission(
      [
        {
          created_at: '2026-11-12T10:00:00.000Z',
          is_credit: true,
          credit_cleared: false,
          amount_paid_ugx: 0,
          total_ugx: 8000,
          items: [{ line_total: 8000, breakdown: { mint: 1 } }],
        },
      ],
      [],
    );
    expect(credit.commission).toBe(0);
  });
});
