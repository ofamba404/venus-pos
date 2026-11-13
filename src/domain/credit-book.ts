/**
 * Credit on Insights: what is owed, by whom, how old it is, and what came in.
 * There is no due date, so age is the days since the credit sale, and the wording says "owed", never "overdue".
 */
import { rangeBounds, type ChartRange } from './analytics/periods';
import { creditBalance, isOutstandingCredit, type CreditSale } from './credit';
import { formatUGX } from './format';
import { localPhoneDigits } from './phone';

const DAY_MS = 86_400_000;

export type CreditOrder = {
  id: string;
  date: string;
  ageDays: number;
  total: number;
  paid: number;
  balance: number;
};

export type CreditPerson = {
  key: string;
  clientId: string;
  name: string;
  phone: string;
  whatsapp: string;
  owed: number;
  /** Days since this person's oldest open credit sale. */
  oldestDays: number;
  ageLabel: string;
  orders: CreditOrder[];
};

export type AgeBucketId = 'week' | 'two' | 'four' | 'older';

export type AgeBucket = { id: AgeBucketId; label: string; amount: number; count: number };

export type CreditBook = {
  owed: number;
  people: CreditPerson[];
  buckets: AgeBucket[];
};

type BookSale = CreditSale & { client_phone?: string | null };
type BookClient = { id: string; name?: string | null; phone?: string | null };
export type CreditPayment = { client_id?: string | null; amount_ugx?: number | string | null; created_at?: string | null };

/** "owed today", "owed 6 days", "owed 3 weeks". */
export function owedAgeLabel(days: number): string {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  if (d === 0) return 'owed today';
  if (d < 14) return `owed ${d} ${d === 1 ? 'day' : 'days'}`;
  const weeks = Math.floor(d / 7);
  return `owed ${weeks} weeks`;
}

export function ageBucketOf(days: number): AgeBucketId {
  if (days < 7) return 'week';
  if (days < 14) return 'two';
  if (days < 28) return 'four';
  return 'older';
}

const BUCKET_LABELS: Record<AgeBucketId, string> = {
  week: 'Under 1 week',
  two: '1–2 weeks',
  four: '2–4 weeks',
  older: 'Older',
};

/** A polite reminder that carries the amount. The owner reads it and presses send. */
export function reminderText(name: string | null | undefined, amount: number): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const hello = first && !/^[0-9+]/.test(first) && first.toLowerCase() !== 'client' ? `Hello ${first}` : 'Hello';
  return `${hello}, a friendly reminder from Venus: ${formatUGX(amount)} is still outstanding on your account. Please settle when you can. Thank you!`;
}

/** wa.me link with the reminder prefilled. Empty when there is no 9-digit number. */
export function reminderLink(phone: string | null | undefined, name: string | null | undefined, amount: number): string {
  const digits = localPhoneDigits(phone);
  if (digits.length !== 9) return '';
  return `https://wa.me/256${digits}?text=${encodeURIComponent(reminderText(name, amount))}`;
}

/** Everyone with an open credit sale, oldest debt first, plus the amount owed by age of each sale. */
export function creditBook(
  sales: BookSale[] | null | undefined,
  clients: BookClient[] | null | undefined,
  now = new Date(),
): CreditBook {
  const names = new Map((clients || []).map((c) => [c.id, c.name || 'Client']));
  const phones = new Map((clients || []).map((c) => [c.id, c.phone || '']));
  const people = new Map<string, CreditPerson>();
  const buckets = new Map<AgeBucketId, AgeBucket>(
    (Object.keys(BUCKET_LABELS) as AgeBucketId[]).map((id) => [id, { id, label: BUCKET_LABELS[id], amount: 0, count: 0 }]),
  );
  let owed = 0;
  for (const sale of sales || []) {
    if (!isOutstandingCredit(sale)) continue;
    const balance = creditBalance(sale);
    if (balance <= 0) continue;
    const at = new Date(sale.created_at || 0).getTime();
    const ageDays = at ? Math.max(0, Math.floor((now.getTime() - at) / DAY_MS)) : 0;
    const clientId = String(sale.client_id || '');
    const key = clientId || `walk-in:${sale.id}`;
    let person = people.get(key);
    if (!person) {
      person = {
        key,
        clientId,
        name: (clientId && names.get(clientId)) || 'Client',
        phone: '',
        whatsapp: '',
        owed: 0,
        oldestDays: 0,
        ageLabel: '',
        orders: [],
      };
      people.set(key, person);
    }
    if (!person.phone) person.phone = localPhoneDigits((clientId && phones.get(clientId)) || sale.client_phone || '');
    person.owed += balance;
    person.oldestDays = Math.max(person.oldestDays, ageDays);
    person.orders.push({
      id: String(sale.id || ''),
      date: sale.created_at || '',
      ageDays,
      total: Number(sale.total_ugx) || 0,
      paid: Math.max(0, Number(sale.amount_paid_ugx) || 0),
      balance,
    });
    const bucket = buckets.get(ageBucketOf(ageDays))!;
    bucket.amount += balance;
    bucket.count += 1;
    owed += balance;
  }
  const list = [...people.values()]
    .map((p) => ({
      ...p,
      ageLabel: owedAgeLabel(p.oldestDays),
      whatsapp: reminderLink(p.phone, p.name, p.owed),
      orders: [...p.orders].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    }))
    .sort((a, b) => b.oldestDays - a.oldestDays || b.owed - a.owed || a.name.localeCompare(b.name));
  return { owed, people: list, buckets: [...buckets.values()] };
}

/** Money received through credit payments in the range. All time when the range has no bounds. */
export function collectedIn(
  payments: CreditPayment[] | null | undefined,
  range: ChartRange,
  now = new Date(),
): number {
  const bounds = rangeBounds(range, now);
  let sum = 0;
  for (const p of payments || []) {
    const at = new Date(p.created_at || '').getTime();
    if (Number.isNaN(at)) continue;
    if (bounds && (at < bounds.start.getTime() || at > bounds.end.getTime())) continue;
    sum += Math.max(0, Number(p.amount_ugx) || 0);
  }
  return Math.round(sum);
}

/** "this week", "last week", "in the last 2 weeks", "this month", "in the last 3 months", "so far". */
export function collectedPhrase(range: Pick<ChartRange, 'id'>): string {
  switch (range.id) {
    case '1w':
      return 'this week';
    case 'lw':
      return 'last week';
    case '2w':
      return 'in the last 2 weeks';
    case '1m':
      return 'this month';
    case '3m':
      return 'in the last 3 months';
    default:
      return 'so far';
  }
}

export function creditHeadline(book: Pick<CreditBook, 'owed' | 'people'>): string {
  if (book.owed <= 0) return 'All settled';
  const n = book.people.length;
  return `${formatUGX(book.owed)} owed by ${n} ${n === 1 ? 'person' : 'people'}`;
}
