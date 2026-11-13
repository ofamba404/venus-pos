import { describe, expect, it } from 'vitest';
import {
  ageBucketOf,
  collectedIn,
  collectedPhrase,
  creditBook,
  creditHeadline,
  owedAgeLabel,
  reminderLink,
  reminderText,
} from '../../src/domain/credit-book';
import { CHART_RANGES } from '../../src/domain/analytics/periods';

const NOW = new Date(2026, 10, 12, 12);
const daysAgo = (n: number) => new Date(2026, 10, 12 - n, 10).toISOString();
const credit = (id: string, clientId: string | null, total: number, paid: number, age: number, extra = {}) => ({
  id,
  client_id: clientId,
  is_credit: true,
  credit_cleared: false,
  total_ugx: total,
  amount_paid_ugx: paid,
  created_at: daysAgo(age),
  ...extra,
});
const clients = [
  { id: 'a', name: 'Jane Doe', phone: '0772 111 222' },
  { id: 'b', name: 'Brian', phone: null },
];
const range = (id: string) => CHART_RANGES.find((r) => r.id === id)!;

describe('credit book', () => {
  const sales = [
    credit('s1', 'a', 15000, 0, 6),
    credit('s2', 'a', 20000, 6000, 20),
    credit('s3', 'b', 14000, 0, 40, { client_phone: '0701555666' }),
    credit('s4', 'b', 9000, 9000, 3), // fully paid: nothing owed
    { ...credit('s5', 'a', 5000, 0, 2), credit_cleared: true },
    { id: 's6', client_id: 'a', is_credit: false, total_ugx: 8000, created_at: daysAgo(1) },
  ];

  it('totals what is owed, per person, oldest debt first', () => {
    const book = creditBook(sales, clients, NOW);
    expect(book.owed).toBe(15000 + 14000 + 14000);
    expect(book.people.map((p) => p.name)).toEqual(['Brian', 'Jane Doe']);
    expect(creditHeadline(book)).toBe('UGX 43,000 owed by 2 people');
    const jane = book.people[1]!;
    expect(jane).toMatchObject({ owed: 29000, oldestDays: 20, ageLabel: 'owed 2 weeks', phone: '772111222' });
    expect(jane.orders.map((o) => [o.id, o.balance, o.total])).toEqual([
      ['s2', 14000, 20000],
      ['s1', 15000, 15000],
    ]);
  });

  it('splits the owed amount by the age of each sale', () => {
    const buckets = creditBook(sales, clients, NOW).buckets;
    expect(buckets.map((b) => [b.id, b.amount, b.count])).toEqual([
      ['week', 15000, 1],
      ['two', 0, 0],
      ['four', 14000, 1],
      ['older', 14000, 1],
    ]);
    expect(buckets.reduce((a, b) => a + b.amount, 0)).toBe(43000);
    expect([0, 6, 7, 13, 14, 27, 28, 90].map(ageBucketOf)).toEqual(['week', 'week', 'two', 'two', 'four', 'four', 'older', 'older']);
  });

  it('says owed, never overdue, and is plain about age', () => {
    expect([0, 1, 6, 13, 14, 20, 35].map(owedAgeLabel)).toEqual([
      'owed today',
      'owed 1 day',
      'owed 6 days',
      'owed 13 days',
      'owed 2 weeks',
      'owed 2 weeks',
      'owed 5 weeks',
    ]);
    const all = JSON.stringify(creditBook(sales, clients, NOW)).toLowerCase();
    expect(all).not.toContain('overdue');
  });

  it('is All settled with nothing open, and keeps a client with no number', () => {
    const empty = creditBook([credit('x', 'a', 100, 100, 1)], clients, NOW);
    expect(empty.owed).toBe(0);
    expect(creditHeadline(empty)).toBe('All settled');
    expect(creditBook(null, null, NOW).people).toEqual([]);
    const walkIn = creditBook([credit('w1', null, 3000, 0, 1), credit('w2', null, 2000, 0, 1)], [], NOW);
    expect(walkIn.people).toHaveLength(2);
    expect(walkIn.people[0]!.name).toBe('Client');
    expect(creditHeadline({ owed: 5000, people: walkIn.people.slice(0, 1) })).toBe('UGX 5,000 owed by 1 person');
  });

  it('builds a polite WhatsApp reminder with the amount, and no link without a 9-digit number', () => {
    expect(reminderText('Jane Doe', 29000)).toBe(
      'Hello Jane, a friendly reminder from Venus: UGX 29,000 is still outstanding on your account. Please settle when you can. Thank you!',
    );
    expect(reminderText('0700000000', 1000).startsWith('Hello, ')).toBe(true);
    expect(reminderText('Client', 1000).startsWith('Hello, ')).toBe(true);
    const link = reminderLink('0772111222', 'Jane Doe', 29000);
    expect(link.startsWith('https://wa.me/256772111222?text=')).toBe(true);
    expect(decodeURIComponent(link.split('?text=')[1]!)).toContain('UGX 29,000');
    expect(reminderLink('12', 'Jane', 1000)).toBe('');
    expect(reminderLink(null, 'Jane', 1000)).toBe('');
  });

  it('collected is credit payments inside the range, and every one for All time', () => {
    const payments = [
      { client_id: 'a', amount_ugx: 5000, created_at: daysAgo(1) },
      { client_id: 'a', amount_ugx: '2000', created_at: daysAgo(2) },
      { client_id: 'b', amount_ugx: 7000, created_at: daysAgo(30) },
      { client_id: 'b', amount_ugx: 1000, created_at: 'nope' },
    ];
    expect(collectedIn(payments, range('1w'), NOW)).toBe(7000);
    expect(collectedIn(payments, range('lw'), NOW)).toBe(0);
    expect(collectedIn(payments, range('1m'), NOW)).toBe(7000);
    expect(collectedIn(payments, range('all'), NOW)).toBe(14000);
    expect(collectedIn(null, range('1w'), NOW)).toBe(0);
    expect(['1w', 'lw', '2w', '1m', '3m', 'all'].map((id) => collectedPhrase({ id }))).toEqual([
      'this week',
      'last week',
      'in the last 2 weeks',
      'this month',
      'in the last 3 months',
      'so far',
    ]);
  });
});
