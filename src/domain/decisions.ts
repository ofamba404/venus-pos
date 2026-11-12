/**
 * The questions the owner decides on from Insights.
 * Rates come from ECONOMICS. Joint cost comes from joint_cost_history.
 */
import { priorBounds, rangeBounds, type ChartRange } from './analytics/periods';
import { canonicalProductName } from './analytics/rank';
import { CAT_MAP, PRODUCTS, cookieWholesaleUgx, isCookieCategoryId } from './catalog';
import { ECONOMICS, type Economics } from './economics';
import { jointCostAt, type JointCostRow } from './joint-cost';
import { historyOrDefault } from './insights-view';
import {
  allocateCookieLineRevenue,
  cookieFlavorEntriesFromItem,
  salePaidRatio,
  type SaleItemLike,
  type SaleLike,
} from './revenue';

const PACK_IDS = ['scout', 'pilot', 'commander', 'variety'] as const;

export {
  creditChase,
  restockLine,
  restockListText,
  restockPlan,
  whatsappLink,
} from './decisions-book';
export type { ChaseRow, RestockRow } from './decisions-book';

export type DecisionItem = SaleItemLike & {
  is_reward?: boolean;
  product_id?: string;
  product_name?: string;
  line_total?: number;
};

export type DecisionSale = SaleLike & {
  id?: string;
  client_id?: string | null;
  client_phone?: string | null;
  items?: DecisionItem[] | null;
};

export type PackLine = {
  id: string;
  name: string;
  unitProfit: number;
  soldProfit: number;
};

export type ProfitPicture = {
  owner: number;
  helper: number;
  partner: number;
  jointProfit: number;
  packs: PackLine[];
  biggerPacks: boolean | null;
  helperShare: number;
};

function ratesOf(rates?: Partial<Economics>): Economics {
  return {
    helperShare: rates?.helperShare ?? ECONOMICS.helperShare,
    ownerCookieShare: rates?.ownerCookieShare ?? ECONOMICS.ownerCookieShare,
    restockCycleDays: rates?.restockCycleDays ?? ECONOMICS.restockCycleDays,
  };
}

function productKind(item: DecisionItem | null | undefined): string {
  const id = String(item?.product_id || item?.productId || '')
    .toLowerCase()
    .replace(/-/g, '_');
  const name = String(item?.product_name || item?.name || '').toLowerCase();
  if (id.includes('wholesale') || name.includes('wholesale')) return 'wholesale';
  if (id.includes('quartet') || name.includes('quartet')) return 'quartet';
  if (id.includes('trio') || name.includes('trio')) return 'trio';
  if (id.includes('duet') || name.includes('duet')) return 'duet';
  return 'single';
}

function cookieTake(item: DecisionItem, share: number): { owner: number; partner: number; wholesale: boolean } | null {
  const entries = cookieFlavorEntriesFromItem(item);
  if (!entries.length) return null;
  const revenue = Math.max(0, Number(item.line_total) || 0);
  const kind = productKind(item);
  const allocs = allocateCookieLineRevenue(entries, revenue, kind);
  let owner = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const profit = (allocs[i] || 0) - entry.qty * cookieWholesaleUgx(entry.flavorId);
    if (profit > 0) owner += profit * share;
  }
  owner = Math.round(owner);
  return { owner, partner: Math.max(0, Math.round(revenue - owner)), wholesale: kind === 'wholesale' };
}

function jointCostOf(item: DecisionItem, history: JointCostRow[], at: string): number {
  let cost = 0;
  for (const [id, raw] of Object.entries(item.breakdown || {})) {
    if (isCookieCategoryId(id) || !CAT_MAP[id]) continue;
    const qty = Math.round(Number(raw) || 0);
    if (qty <= 0) continue;
    cost += jointCostAt(history, id, at, 0) * qty;
  }
  return cost;
}

function packMix(id: string): { flavoured: number; plain: number } {
  const product = PRODUCTS.find((row) => row.id === id)!;
  const joints = product.joints!;
  if (product.rule === 'choose_variety') return { flavoured: Math.max(0, joints - 1), plain: 1 };
  return { flavoured: joints, plain: 0 };
}

export function packUnitProfits(history: JointCostRow[] | null | undefined, at: string | Date = new Date()): PackLine[] {
  const costs = historyOrDefault(history);
  const flavoured = jointCostAt(costs, 'mint', at, 0);
  const plain = jointCostAt(costs, 'classic', at, 0);
  return PACK_IDS.map((id) => {
    const product = PRODUCTS.find((row) => row.id === id)!;
    const mix = packMix(id);
    const unitProfit = Math.round(product.price! - mix.flavoured * flavoured - mix.plain * plain);
    return { id, name: product.name, unitProfit, soldProfit: 0 };
  });
}

function lineContribution(
  item: DecisionItem,
  sale: DecisionSale,
  history: JointCostRow[],
  rates: Economics,
): { owner: number; helper: number; partner: number; margin: number; packId: string } {
  if (item.is_reward) return { owner: 0, helper: 0, partner: 0, margin: 0, packId: '' };
  const ratio = salePaidRatio(sale);
  if (ratio <= 0) return { owner: 0, helper: 0, partner: 0, margin: 0, packId: '' };
  const cookie = cookieTake(item, rates.ownerCookieShare);
  if (cookie) {
    const ownerSplit = cookie.owner * ratio;
    const helper = cookie.wholesale ? 0 : ownerSplit * rates.helperShare;
    return {
      owner: ownerSplit - helper,
      helper,
      partner: cookie.partner * ratio,
      margin: ownerSplit,
      packId: '',
    };
  }
  const cost = jointCostOf(item, history, sale.created_at || '1970-01-01T00:00:00.000Z');
  const margin = Math.max(0, (Number(item.line_total) || 0) - cost) * ratio;
  const helper = margin * rates.helperShare;
  const packId = PACK_IDS.includes(String(item.product_id) as (typeof PACK_IDS)[number]) ? String(item.product_id) : '';
  return { owner: margin - helper, helper, partner: 0, margin, packId };
}

/** Profit after joint cost, helper commission, and the cookie partner's share. */
export function profitPicture(
  sales: DecisionSale[] | null | undefined,
  history: JointCostRow[] | null | undefined,
  rates?: Partial<Economics>,
): ProfitPicture {
  const economics = ratesOf(rates);
  const costs = historyOrDefault(history);
  const packs = new Map(packUnitProfits(costs).map((row) => [row.id, { ...row }]));
  let owner = 0;
  let helper = 0;
  let partner = 0;
  let jointProfit = 0;
  for (const sale of sales || []) {
    for (const item of sale.items || []) {
      const take = lineContribution(item, sale, costs, economics);
      owner += take.owner;
      helper += take.helper;
      partner += take.partner;
      if (take.packId) {
        jointProfit += take.margin;
        const pack = packs.get(take.packId);
        if (pack) pack.soldProfit += take.margin;
      }
    }
  }
  const list = [...packs.values()].map((row) => ({ ...row, soldProfit: Math.round(row.soldProfit) }));
  const bigger = (packs.get('commander')?.soldProfit || 0) + (packs.get('variety')?.soldProfit || 0);
  const smaller = (packs.get('scout')?.soldProfit || 0) + (packs.get('pilot')?.soldProfit || 0);
  return {
    owner: Math.round(owner),
    helper: Math.round(helper),
    partner: Math.round(partner),
    jointProfit: Math.round(jointProfit),
    packs: list,
    biggerPacks: bigger + smaller === 0 ? null : bigger > smaller,
    helperShare: economics.helperShare,
  };
}

export function packDriverSentence(picture: ProfitPicture): string {
  if (picture.biggerPacks === null) return 'No pack profit in this period.';
  return picture.biggerPacks ? 'Bigger packs are driving profit.' : 'Smaller packs are driving profit.';
}

function driverPhrase(name: string): string {
  if (/commander/i.test(name)) return 'Commander packs';
  if (/scout/i.test(name)) return 'Scout packs';
  if (/pilot/i.test(name)) return 'Pilot packs';
  if (/variety/i.test(name)) return 'Variety packs';
  if (/cookie/i.test(name)) return 'cookies';
  return name || 'sales';
}

function contributions(sales: DecisionSale[], history: JointCostRow[], rates: Economics): Map<string, number> {
  const totals = new Map<string, number>();
  for (const sale of sales) {
    for (const item of sale.items || []) {
      const take = lineContribution(item, sale, history, rates);
      const name = canonicalProductName(item.product_name || item.name);
      totals.set(name, (totals.get(name) || 0) + take.owner);
    }
  }
  return totals;
}

export function compareLabel(range: ChartRange | null | undefined): string {
  if (!range?.unit) return '';
  if (range.unit === 'week' && (range.count || 1) === 1 && !range.offset) return 'last week';
  if (range.unit === 'week' && range.offset === 1 && (range.count || 1) === 1) return 'the week before';
  if (range.unit === 'week') return 'the previous weeks';
  if ((range.count || 1) === 1) return 'last month';
  return 'the previous months';
}

/** One sentence: better or worse than the previous period, and what moved it. */
export function periodSentence(
  sales: DecisionSale[] | null | undefined,
  range: ChartRange | null | undefined,
  history: JointCostRow[] | null | undefined,
  now = new Date(),
  rates?: Partial<Economics>,
): { text: string; tone: 'up' | 'down' | 'neutral' } {
  if (!range?.unit) return { text: 'All time has no earlier period to compare.', tone: 'neutral' };
  const bounds = rangeBounds(range, now)!;
  const prior = priorBounds(range, now)!;
  const list = sales || [];
  const inWindow = (start: Date, end: Date) =>
    list.filter((sale) => {
      const at = new Date(sale.created_at || 0);
      return at >= start && at <= end;
    });
  const economics = ratesOf(rates);
  const costs = historyOrDefault(history);
  const current = contributions(inWindow(bounds.start, bounds.end), costs, economics);
  const previous = contributions(inWindow(prior.start, prior.end), costs, economics);
  const sum = (map: Map<string, number>) => [...map.values()].reduce((total, value) => total + value, 0);
  const nowTotal = sum(current);
  const thenTotal = sum(previous);
  const against = compareLabel(range);
  const names = new Set([...current.keys(), ...previous.keys()]);
  let driver = '';
  let driverDelta = 0;
  const direction = nowTotal - thenTotal;
  for (const name of names) {
    const delta = (current.get(name) || 0) - (previous.get(name) || 0);
    const matches = direction > 0 ? delta > driverDelta : direction < 0 ? delta < driverDelta : false;
    if (matches) {
      driverDelta = delta;
      driver = name;
    }
  }
  const phrase = driverPhrase(driver);
  if (thenTotal === 0 && nowTotal === 0) return { text: `Flat on ${against}.`, tone: 'neutral' };
  if (thenTotal === 0) return { text: `First sales this period, mostly from ${phrase}.`, tone: 'up' };
  const pct = Math.round(((nowTotal - thenTotal) / thenTotal) * 100);
  if (pct === 0) return { text: `Flat on ${against}.`, tone: 'neutral' };
  if (pct > 0) return { text: `Up ${pct}% on ${against}, mostly from ${phrase}.`, tone: 'up' };
  return { text: `Down ${Math.abs(pct)}% on ${against}, mostly from fewer ${phrase}.`, tone: 'down' };
}
