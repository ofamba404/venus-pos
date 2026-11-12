/**
 * Insights aggregates the owner asked for: flavour mix, product bars,
 * credit aging, top clients, and staff commission from joint_cost_history.
 */
import { CAT_MAP, isCookieCategoryId } from './catalog';
import { canonicalProductName } from './analytics/rank';
import {
  FLAVORED_JOINT_COST_4000_FROM,
  FLAVORED_JOINT_IDS,
  jointCostAt,
  type JointCostRow,
} from './joint-cost';
import { isOutstandingCredit, type CreditSale } from './credit';
import { saleRecognizedOwnerRevenue, type SaleLike } from './revenue';

export const DEFAULT_STAFF_RATE = 0.4;

const PLAIN_IDS = ['classic', 'spliff5050', 'spliff7030'] as const;

/** Same schedule as migration 20261111153700 when the history table is empty. */
export function defaultJointHistory(): JointCostRow[] {
  const rows: JointCostRow[] = [];
  for (const id of FLAVORED_JOINT_IDS) {
    rows.push({ category_id: id, cost_ugx: 5000, effective_from: '1970-01-01T00:00:00.000Z' });
    rows.push({ category_id: id, cost_ugx: 4000, effective_from: FLAVORED_JOINT_COST_4000_FROM });
  }
  for (const id of PLAIN_IDS) {
    rows.push({ category_id: id, cost_ugx: 3000, effective_from: '1970-01-01T00:00:00.000Z' });
  }
  return rows;
}

export function historyOrDefault(rows: JointCostRow[] | null | undefined): JointCostRow[] {
  return rows && rows.length ? rows : defaultJointHistory();
}

type MixSale = SaleLike & {
  id?: string;
  client_id?: string | null;
  created_at?: string;
  items?: Array<{
    product_name?: string;
    line_total?: number;
    is_reward?: boolean;
    breakdown?: Record<string, unknown> | null;
  }> | null;
};

export type FlavorSlice = { id: string; name: string; color: string; qty: number };
export type ProductBar = { name: string; count: number; revenue: number };
export type AgingBucket = { id: string; label: string; total: number; count: number };
export type ClientRank = { id: string; name: string; revenue: number; orders: number };

export function flavorMix(sales: MixSale[] | null | undefined): FlavorSlice[] {
  const qty = new Map<string, number>();
  for (const sale of sales || []) {
    for (const item of sale.items || []) {
      for (const [id, raw] of Object.entries(item.breakdown || {})) {
        const n = Math.round(Number(raw) || 0);
        if (n <= 0) continue;
        qty.set(id, (qty.get(id) || 0) + n);
      }
    }
  }
  return [...qty.entries()]
    .map(([id, count]) => ({
      id,
      name: CAT_MAP[id]?.name || id,
      color: CAT_MAP[id]?.color || '#c4a574',
      qty: count,
    }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

export function productBars(sales: MixSale[] | null | undefined): ProductBar[] {
  const rows = new Map<string, ProductBar>();
  for (const sale of sales || []) {
    for (const item of sale.items || []) {
      const name = canonicalProductName(item.product_name);
      const row = rows.get(name) || { name, count: 0, revenue: 0 };
      row.count += 1;
      row.revenue += Math.round(Number(item.line_total) || 0);
      rows.set(name, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.count - a.count);
}

export function creditAging(sales: CreditSale[] | null | undefined, now = new Date()): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { id: 'week', label: '0–7 days', total: 0, count: 0 },
    { id: 'month', label: '8–30 days', total: 0, count: 0 },
    { id: 'older', label: '31+ days', total: 0, count: 0 },
  ];
  for (const sale of sales || []) {
    if (!isOutstandingCredit(sale)) continue;
    const age = Math.floor((now.getTime() - new Date(sale.created_at || 0).getTime()) / 86_400_000);
    const owed = Math.max(0, Math.round(Number(sale.total_ugx) || 0) - Math.round(Number(sale.amount_paid_ugx) || 0));
    const bucket = age <= 7 ? buckets[0]! : age <= 30 ? buckets[1]! : buckets[2]!;
    bucket.total += owed;
    bucket.count += 1;
  }
  return buckets;
}

export function topClients(
  sales: MixSale[] | null | undefined,
  clients: Array<{ id: string; name?: string | null }> | null | undefined,
  limit = 5,
): ClientRank[] {
  const names = new Map((clients || []).map((c) => [c.id, c.name || 'Client']));
  const rows = new Map<string, ClientRank>();
  for (const sale of sales || []) {
    const id = String(sale.client_id || '');
    if (!id) continue;
    const row = rows.get(id) || { id, name: names.get(id) || 'Client', revenue: 0, orders: 0 };
    row.revenue += Math.round(saleRecognizedOwnerRevenue(sale));
    row.orders += 1;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Staff commission on joint profit. Cost comes from joint_cost_history at the
 * sale time. Unpaid credit and reward lines wait until they are paid.
 */
export function jointCommission(
  sales: MixSale[] | null | undefined,
  history: JointCostRow[] | null | undefined,
  rate = DEFAULT_STAFF_RATE,
): { profit: number; commission: number; rate: number } {
  const costs = historyOrDefault(history);
  const share = Math.max(0, Number(rate) || 0);
  let profit = 0;
  for (const sale of sales || []) {
    if (isOutstandingCredit(sale)) continue;
    for (const item of sale.items || []) {
      if (item.is_reward) continue;
      let cost = 0;
      let units = 0;
      for (const [id, raw] of Object.entries(item.breakdown || {})) {
        if (isCookieCategoryId(id)) continue;
        const qty = Math.round(Number(raw) || 0);
        if (qty <= 0 || !CAT_MAP[id]) continue;
        units += qty;
        cost += jointCostAt(costs, id, sale.created_at || '1970-01-01T00:00:00.000Z', 0) * qty;
      }
      if (units <= 0) continue;
      profit += Math.max(0, Math.round(Number(item.line_total) || 0) - cost);
    }
  }
  return { profit, commission: Math.round(profit * share), rate: share };
}
