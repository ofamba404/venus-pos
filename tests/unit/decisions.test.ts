import { describe, expect, it } from 'vitest';
import { CHART_RANGES, rangeBounds } from '../../src/domain/analytics/periods';
import { buildDefaultSeed } from '../fixtures/seed';
import { ECONOMICS } from '../../src/domain/economics';
import {
  compareLabel,
  creditChase,
  packDriverSentence,
  packUnitProfits,
  periodSentence,
  profitPicture,
  restockLine,
  restockListText,
  restockPlan,
  whatsappLink,
} from '../../src/domain/decisions';
import { defaultJointHistory } from '../../src/domain/insights-view';

const at = '2026-11-12T12:00:00.000Z';

describe('restock', () => {
  it('flags a flavour that runs out before the next cycle and orders the shortfall', () => {
    const now = new Date(at);
    const rows = restockPlan(
      [
        {
          created_at: '2026-11-08T12:00:00.000Z',
          items: [{ breakdown: { grape: 14 }, line_total: 1 }],
        },
      ],
      { grape: 4, coconut: 30, mint: 0, classic: 10 },
      now,
    );
    const grape = rows.find((row) => row.id === 'grape');
    const coconut = rows.find((row) => row.id === 'coconut');
    const mint = rows.find((row) => row.id === 'mint');
    const plain = rows.find((row) => row.id === 'classic');
    expect(grape).toMatchObject({ urgent: true, orderQty: 10, daysLeft: 4 });
    expect(grape?.line).toBe('Grape runs out in ~4 days');
    expect(coconut?.urgent).toBe(false);
    expect(coconut?.line).toBe('Coconut: no sales in 2 weeks');
    expect(mint?.line).toBe('Mint is out');
    expect(mint?.orderQty).toBe(0);
    expect(plain?.line).toBe('Plain: no sales in 2 weeks');
    expect(rows[0]?.urgent).toBe(true);
    expect(restockListText(rows)).toContain('Grape — 10');
    expect(restockListText(null)).toContain('Nothing to order');
    expect(restockLine('Grape', 1, 1 / 14, 14)).toBe('Grape runs out in ~1 day');
    expect(restockLine('Coconut', 21, 21, 14)).toBe('Coconut: 3 weeks left');
    expect(restockLine('Coconut', 7, 7, 7)).toBe('Coconut: 1 week left');
  });

  it('ignores rewards and sales outside the cycle', () => {
    const now = new Date(at);
    const rows = restockPlan(
      [
        { created_at: '2026-01-01T00:00:00.000Z', items: [{ breakdown: { mint: 50 } }] },
        { created_at: at, items: [{ is_reward: true, breakdown: { mint: 9 } }] },
        { created_at: at, items: [{ breakdown: { nope: 4, mint: 0 } }] },
      ],
      { mint: 8 },
      now,
    );
    expect(rows.find((row) => row.id === 'mint')).toMatchObject({ sold: 0, orderQty: 0, urgent: false });
  });
});

describe('who to chase', () => {
  it('sorts by days owed and builds a 9-digit WhatsApp link', () => {
    const now = new Date('2026-11-12T12:00:00.000Z');
    const rows = creditChase(
      [
        {
          id: 'new',
          client_id: 'a',
          is_credit: true,
          total_ugx: 1000,
          amount_paid_ugx: 0,
          created_at: '2026-11-10T12:00:00.000Z',
        },
        {
          id: 'old',
          client_id: 'b',
          is_credit: true,
          total_ugx: 500,
          amount_paid_ugx: 100,
          created_at: '2026-11-01T12:00:00.000Z',
          client_phone: '+256772111222',
        },
        {
          id: 'paid',
          client_id: 'a',
          is_credit: true,
          credit_cleared: true,
          total_ugx: 9000,
          created_at: '2026-10-01T00:00:00.000Z',
        },
        { id: 'cash', client_id: 'c', is_credit: false, total_ugx: 100, created_at: at },
        {
          id: 'newer',
          client_id: 'b',
          is_credit: true,
          total_ugx: 50,
          created_at: '2026-11-11T12:00:00.000Z',
        },
        { is_credit: true, total_ugx: 20, created_at: '2026-11-09T12:00:00.000Z' },
      ],
      [
        { id: 'a', name: 'Amina', phone: '0700333444' },
        { id: 'b', name: 'Ben' },
      ],
      now,
    );
    expect(rows.map((row) => row.name)).toEqual(['Ben', 'Client', 'Amina']);
    expect(rows[0]).toMatchObject({ owed: 450, phone: '772111222', whatsapp: 'https://wa.me/256772111222' });
    expect(rows.some((row) => row.name === 'Client')).toBe(true);
    expect(rows.find((row) => row.name === 'Amina')?.whatsapp).toBe('https://wa.me/256700333444');
    expect(whatsappLink('12')).toBe('');
    expect(whatsappLink(null)).toBe('');
  });
});

describe('what you are making', () => {
  it('prices the four packs at the 4,000 joint cost', () => {
    const packs = packUnitProfits(defaultJointHistory(), '2026-11-12T00:00:00.000Z');
    expect(packs.map((row) => [row.id, row.unitProfit])).toEqual([
      ['scout', 4000],
      ['pilot', 7000],
      ['commander', 15000],
      ['variety', 19000],
    ]);
    expect(packUnitProfits(null, '2026-11-01T00:00:00.000Z').find((row) => row.id === 'scout')?.unitProfit).toBe(3000);
  });

  it('keeps 675 of 1,125 on a retail cookie and skips wholesale commission', () => {
    const retail = profitPicture(
      [
        {
          created_at: at,
          items: [{ product_id: 'cookie_single', product_name: 'Butterscotch Cookie', line_total: 5000, breakdown: { cookie_butterscotch: 1 } }],
        },
      ],
      defaultJointHistory(),
    );
    expect(retail.owner).toBe(675);
    expect(retail.helper).toBe(450);
    expect(retail.partner).toBe(3875);

    const wholesale = profitPicture(
      [
        {
          created_at: at,
          items: [{ product_id: 'cookie_wholesale', product_name: 'Wholesale cookies', line_total: 4000, breakdown: { cookie_butterscotch: 1 } }],
        },
      ],
      defaultJointHistory(),
    );
    expect(wholesale.helper).toBe(0);
    expect(wholesale.owner).toBe(675);
    expect(wholesale.partner).toBe(3325);
  });

  it('takes 40% of joint profit and ignores rewards and unpaid credit', () => {
    const picture = profitPicture(
      [
        {
          created_at: at,
          items: [{ product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { mint: 1 } }],
        },
        {
          created_at: at,
          is_credit: true,
          total_ugx: 8000,
          amount_paid_ugx: 0,
          items: [{ product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { mint: 1 } }],
        },
        {
          created_at: at,
          items: [{ is_reward: true, product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { mint: 1 } }],
        },
        {
          created_at: at,
          is_credit: true,
          total_ugx: 8000,
          amount_paid_ugx: 4000,
          items: [{ product_id: 'pilot', product_name: 'Pilot Pack', line_total: 15000, breakdown: { mint: 1, grape: 1 } }],
        },
      ],
      defaultJointHistory(),
    );
    expect(picture.jointProfit).toBe(4000 + 3500);
    expect(picture.helper).toBe(Math.round(4000 * ECONOMICS.helperShare + 3500 * ECONOMICS.helperShare));
    expect(picture.packs.find((row) => row.id === 'commander')?.soldProfit).toBe(0);
    expect(packDriverSentence(picture)).toBe('Smaller packs are driving profit.');

    const waived = profitPicture(
      [{ created_at: at, items: [{ product_id: 'plain_single', product_name: 'Plain', line_total: 5000, breakdown: { classic: 1, nope: 2 } }] }],
      defaultJointHistory(),
      { helperShare: 0 },
    );
    expect(waived.helper).toBe(0);
    expect(waived.owner).toBe(2000);
    const none = profitPicture([], null, { helperShare: 0 });
    expect(none.helperShare).toBe(0);
    expect(packDriverSentence(none)).toBe('No pack profit in this period.');

    const bigger = profitPicture(
      [
        {
          created_at: at,
          items: [{ product_id: 'commander', product_name: "Commander's Stash", line_total: 35000, breakdown: { mint: 5 } }],
        },
      ],
      null,
    );
    expect(bigger.biggerPacks).toBe(true);
    expect(packDriverSentence(bigger)).toBe('Bigger packs are driving profit.');
  });
});

describe('this period versus the last one', () => {
  it('names the pack that moved the week', () => {
    const now = new Date(2026, 10, 12, 15, 0, 0);
    const current = rangeBounds(CHART_RANGES[0], now)!;
    const priorStart = new Date(current.start);
    priorStart.setDate(priorStart.getDate() - 7);
    const scout = (created_at: string) => ({
      created_at,
      items: [{ product_id: 'scout', product_name: 'Scout Pack', line_total: 8000, breakdown: { mint: 1 } }],
    });
    const commander = (created_at: string) => ({
      created_at,
      items: [{ product_id: 'commander', product_name: "Commander's Stash", line_total: 35000, breakdown: { mint: 5 } }],
    });
    const up = periodSentence(
      [scout(current.start.toISOString()), commander(current.start.toISOString()), scout(priorStart.toISOString())],
      CHART_RANGES[0],
      defaultJointHistory(),
      now,
    );
    expect(up.tone).toBe('up');
    expect(up.text).toMatch(/^Up \d+% on last week, mostly from Commander packs\.$/);

    const down = periodSentence(
      [scout(current.start.toISOString()), commander(priorStart.toISOString())],
      CHART_RANGES[0],
      defaultJointHistory(),
      now,
    );
    expect(down.text).toMatch(/^Down \d+% on last week, mostly from fewer Commander packs\.$/);

    const flat = periodSentence([], CHART_RANGES[0], null, now);
    expect(flat.text).toBe('Flat on last week.');
    const same = periodSentence(
      [scout(current.start.toISOString()), scout(priorStart.toISOString())],
      CHART_RANGES[0],
      defaultJointHistory(),
      now,
    );
    expect(same.text).toBe('Flat on last week.');
    const first = periodSentence([commander(current.start.toISOString())], CHART_RANGES[0], defaultJointHistory(), now);
    expect(first.text).toBe('First sales this period, mostly from Commander packs.');
    expect(periodSentence([], CHART_RANGES.find((row) => row.id === 'all'), null, now).text).toMatch(/no earlier period/);
    expect(compareLabel(CHART_RANGES.find((row) => row.id === '1m') || null)).toBe('last month');
    expect(compareLabel(CHART_RANGES.find((row) => row.id === '3m') || null)).toBe('the previous months');
    expect(compareLabel(CHART_RANGES.find((row) => row.id === 'lw') || null)).toBe('the week before');
    expect(compareLabel(CHART_RANGES.find((row) => row.id === '2w') || null)).toBe('the previous weeks');
    expect(compareLabel(null)).toBe('');
  });

  it('covers empty inputs and the other pack names', () => {
    const now = new Date(2026, 10, 12, 15, 0, 0);
    const current = rangeBounds(CHART_RANGES[0], now)!;
    const priorStart = new Date(current.start);
    priorStart.setDate(priorStart.getDate() - 3);
    const sale = (name: string, id: string, total: number, breakdown: Record<string, number>) => ({
      created_at: current.start.toISOString(),
      items: [{ product_id: id, product_name: name, line_total: total, breakdown }],
    });
    expect(periodSentence([sale('Scout Pack', 'scout', 8000, { mint: 1 })], CHART_RANGES[0], null, now).text).toMatch(/Scout packs/);
    expect(periodSentence([sale('Pilot Pack', 'pilot', 15000, { mint: 2 })], CHART_RANGES[0], null, now).text).toMatch(/Pilot packs/);
    expect(periodSentence([sale('Variety Pack', 'variety', 50000, { mint: 7, classic: 1 })], CHART_RANGES[0], null, now).text).toMatch(/Variety packs/);
    expect(periodSentence([sale('Butterscotch Cookie', 'cookie_single', 5000, { cookie_butterscotch: 1 })], CHART_RANGES[0], null, now).text).toMatch(/cookies/);
    expect(periodSentence([sale('Bangis', 'spliff_single', 5000, { spliff7030: 1 })], CHART_RANGES[0], null, now).text).toMatch(/Bangis/);
    expect(restockPlan(null, null, now)).toHaveLength(12);
    expect(restockPlan([{ items: null }, { items: [{}] }], undefined, now, { restockCycleDays: 0 })).toHaveLength(12);
    expect(creditChase(null, null, now)).toEqual([]);
    expect(creditChase([{ is_credit: true, total_ugx: 10 }], [{ id: 'walk-in', name: '', phone: undefined }], now)[0]?.name).toBe('Client');
    expect(profitPicture(null, null).owner).toBe(0);
    expect(
      profitPicture(
        [
          {
            items: [
              { productId: 'cookie_quartet', name: 'Cookie Quartet', line_total: 25000, breakdown: { cookie_mint: 3, cookie_butterscotch: 1 } },
              { name: 'Cookie Trio', line_total: 21000, breakdown: { cookie_mint: 3 } },
              { product_id: 'cookie_duet', line_total: 0, breakdown: { cookie_mint: 2 } },
              { product_id: 'scout', line_total: 1000, breakdown: { mint: 0, grape: 1 } },
            ],
          },
        ],
        null,
      ).partner,
    ).toBeGreaterThan(0);
    expect(compareLabel({ id: 'x', label: 'x', short: 'x', unit: 'week', count: null })).toBe('last week');
    expect(compareLabel({ id: 'x', label: 'x', short: 'x', unit: 'week', count: null, offset: 1 })).toBe('the week before');
    expect(compareLabel({ id: 'x', label: 'x', short: 'x', unit: 'month', count: null })).toBe('last month');
    expect(periodSentence(null, CHART_RANGES[0], null, now).text).toBe('Flat on last week.');
    expect(creditChase(
      [
        { client_id: 'p', is_credit: true, total_ugx: 10, created_at: '2026-11-10T00:00:00.000Z' },
        { client_id: 'p', is_credit: true, total_ugx: 10, created_at: '2026-11-01T00:00:00.000Z', client_phone: '0700111222' },
        { client_id: 'q', is_credit: true, total_ugx: 10, created_at: '2026-11-10T00:00:00.000Z', client_phone: '0700111333' },
        { client_id: 'q', is_credit: true, total_ugx: 10, created_at: '2026-11-09T00:00:00.000Z' },
        { client_id: 'r', is_credit: true, total_ugx: 5, created_at: '2026-11-10T00:00:00.000Z' },
        { client_id: 's', is_credit: true, total_ugx: 5, created_at: '2026-11-10T00:00:00.000Z' },
        { client_id: 't', is_credit: true, total_ugx: 8, created_at: '2026-11-08T00:00:00.000Z' },
        { client_id: 'u', is_credit: true, total_ugx: 3, created_at: '2026-11-08T00:00:00.000Z' },
      ],
      [
        { id: 'p', name: 'Pat' },
        { id: 'q', name: 'Quin' },
        { id: 'r', name: 'Ann' },
        { id: 's', name: 'Bea' },
        { id: 't', name: 'Tess' },
        { id: 'u', name: 'Uma' },
      ],
      now,
    )[0]?.phone).toBe('700111222');
  });

  it('matches the mock seed without throwing', () => {
    const seed = buildDefaultSeed();
    const now = new Date('2026-11-10T07:30:00.000Z');
    const sentence = periodSentence(seed.sales, CHART_RANGES[0], null, now);
    expect(sentence.text.length).toBeGreaterThan(8);
    const plan = restockPlan(seed.sales, Object.fromEntries(seed.inventory.map((row) => [row.category_id, row.stock])), now);
    expect(plan.length).toBe(12);
    const chase = creditChase(seed.sales, seed.clients, now);
    expect(chase[0]?.days).toBeGreaterThanOrEqual(chase[1]?.days ?? 0);
    expect(profitPicture(seed.sales, null).owner).toBeGreaterThan(0);
  });
});
