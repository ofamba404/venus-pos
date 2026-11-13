/**
 * Restock cover and who to chase. Rates come from ECONOMICS.
 */
import { CAT_MAP, COOKIE_FLAVORS, cookieCategoryId } from './catalog';
import { creditBalance, isOutstandingCredit } from './credit';
import { ECONOMICS, type Economics } from './economics';
import { localPhoneDigits } from './phone';

type BookSale = {
  id?: string;
  client_id?: string | null;
  client_phone?: string | null;
  created_at?: string;
  is_credit?: boolean;
  credit_cleared?: boolean;
  total_ugx?: number;
  amount_paid_ugx?: number;
  items?: Array<{ is_reward?: boolean; breakdown?: Record<string, unknown> | null }> | null;
};

const JOINT_FLAVOURS = ['mint', 'melon', 'grape', 'blueberry', 'watermelon', 'coconut', 'strawberry', 'classic'] as const;

export type RestockRow = {
  id: string;
  name: string;
  color: string;
  stock: number;
  sold: number;
  daysLeft: number | null;
  orderQty: number;
  urgent: boolean;
  line: string;
  /** Joints are rolled by hand; cookies are bought in. */
  kind: 'joint' | 'cookie';
};

/** What you do to restock it: roll a joint, order a cookie. */
export function restockVerb(row: Pick<RestockRow, 'kind'>): 'Roll' | 'Order' {
  return row.kind === 'cookie' ? 'Order' : 'Roll';
}

export type ChaseRow = {
  id: string;
  name: string;
  owed: number;
  days: number;
  phone: string;
  whatsapp: string;
};

function cycleDays(rates?: Partial<Economics>): number {
  return Math.max(1, rates?.restockCycleDays ?? ECONOMICS.restockCycleDays);
}

export function restockLine(name: string, stock: number, daysLeft: number | null, days: number): string {
  if (stock <= 0) return `${name} is out`;
  if (daysLeft === null) return `${name}: no sales in ${Math.round(days / 7)} weeks`;
  const rounded = Math.max(1, Math.round(daysLeft));
  if (rounded < days) return `${name} runs out in ~${rounded} ${rounded === 1 ? 'day' : 'days'}`;
  const weeks = Math.max(1, Math.round(rounded / 7));
  return `${name}: ${weeks} ${weeks === 1 ? 'week' : 'weeks'} left`;
}

function flavourRows(): Array<{ id: string; name: string; kind: 'joint' | 'cookie' }> {
  const joints = JOINT_FLAVOURS.map((id) => ({
    id,
    name: id === 'classic' ? 'Plain' : CAT_MAP[id]!.name,
    kind: 'joint' as const,
  }));
  const cookies = COOKIE_FLAVORS.map((flavor) => ({
    id: cookieCategoryId(flavor.id),
    name: `${flavor.name} cookie`,
    kind: 'cookie' as const,
  }));
  return [...joints, ...cookies];
}

/** Days of cover from the last cycle of sales, and what to order for the next one. */
export function restockPlan(
  sales: BookSale[] | null | undefined,
  stock: Record<string, number> | null | undefined,
  now = new Date(),
  rates?: Partial<Economics>,
): RestockRow[] {
  const days = cycleDays(rates);
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const sold = new Map<string, number>();
  for (const sale of sales || []) {
    const at = new Date(sale.created_at || 0);
    if (at < start || at > now) continue;
    for (const item of sale.items || []) {
      if (item.is_reward) continue;
      for (const [id, raw] of Object.entries(item.breakdown || {})) {
        const qty = Math.round(Number(raw) || 0);
        if (qty <= 0 || !CAT_MAP[id]) continue;
        sold.set(id, (sold.get(id) || 0) + qty);
      }
    }
  }
  const onHand = stock || {};
  const rows = flavourRows().map((flavor) => {
    const have = Math.max(0, Math.round(Number(onHand[flavor.id]) || 0));
    const units = sold.get(flavor.id) || 0;
    const daily = units / days;
    const daysLeft = have <= 0 ? 0 : daily > 0 ? have / daily : null;
    const orderQty = daily > 0 ? Math.max(0, Math.ceil(daily * days - have)) : 0;
    const urgent = have <= 0 || (daysLeft !== null && daysLeft < days);
    return {
      id: flavor.id,
      name: flavor.name,
      color: CAT_MAP[flavor.id]!.color,
      stock: have,
      sold: units,
      daysLeft,
      orderQty,
      urgent,
      kind: flavor.kind,
      line: restockLine(flavor.name, have, daysLeft, days),
    };
  });
  rows.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    const left = a.daysLeft === null ? Number.POSITIVE_INFINITY : a.daysLeft;
    const right = b.daysLeft === null ? Number.POSITIVE_INFINITY : b.daysLeft;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

/** The copied list: a Roll section for joints, an Order section for cookies. */
export function restockListText(rows: RestockRow[] | null | undefined, days = ECONOMICS.restockCycleDays): string {
  const title = `Restock for ${Math.round(days / 7)} weeks`;
  const need = (rows || []).filter((row) => row.orderQty > 0);
  const section = (verb: 'Roll' | 'Order') => {
    const lines = need.filter((row) => restockVerb(row) === verb).map((row) => `${row.name} — ${row.orderQty}`);
    return lines.length ? [`${verb}:`, ...lines].join('\n') : '';
  };
  const body = [section('Roll'), section('Order')].filter(Boolean).join('\n\n');
  return body ? `${title}\n${body}` : `${title}\nNothing to order`;
}

export function whatsappLink(phone: string | null | undefined): string {
  const digits = localPhoneDigits(phone);
  if (digits.length !== 9) return '';
  return `https://wa.me/256${digits}`;
}

/** People with open credit, oldest balance first. */
export function creditChase(
  sales: BookSale[] | null | undefined,
  clients: Array<{ id: string; name?: string | null; phone?: string | null }> | null | undefined,
  now = new Date(),
): ChaseRow[] {
  const names = new Map((clients || []).map((client) => [client.id, client.name || 'Client']));
  const phones = new Map((clients || []).map((client) => [client.id, client.phone || '']));
  const rows = new Map<string, ChaseRow & { oldest: number }>();
  for (const sale of sales || []) {
    if (!isOutstandingCredit(sale) || creditBalance(sale) <= 0) continue;
    const id = String(sale.client_id || sale.id || 'walk-in');
    const at = new Date(sale.created_at || 0).getTime();
    const existing = rows.get(id);
    const phone = phones.get(id) || sale.client_phone || '';
    const days = Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
    if (!existing) {
      rows.set(id, {
        id,
        name: names.get(id) || 'Client',
        owed: creditBalance(sale),
        days,
        phone: localPhoneDigits(phone),
        whatsapp: '',
        oldest: at || now.getTime(),
      });
      continue;
    }
    existing.owed += creditBalance(sale);
    if (at && at < existing.oldest) {
      existing.oldest = at;
      existing.days = days;
    }
    if (!existing.phone && phone) existing.phone = localPhoneDigits(phone);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, whatsapp: whatsappLink(row.phone) }))
    .sort((a, b) => b.days - a.days || b.owed - a.owed || a.name.localeCompare(b.name));
}
