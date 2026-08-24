import {
  COOKIE_FLAVORS,
  COOKIE_OWNER_SHARE,
  COOKIE_PARTNER_SETTLE_EVERY,
  COOKIE_PARTNER_SETTLED_BASELINE,
  COOKIE_PARTNER_TRACK_FROM_MS,
  cookieFlavorIdFromCategory,
  cookieQtyFromBreakdown,
  cookieUnitPrice,
  cookieWholesaleUgx,
  isCookieCategoryId,
  normalizeInventoryBreakdown,
} from './config.js';

/** v4 — shared blob + no destructive clamp; ignores corrupted v3 “all settled” local values. */
const COOKIE_SETTLE_STORAGE_KEY = 'venus-cookie-partner-settled-qty-v4';

/** Cookie qty on a sale line (any `cookie_*` or legacy `cookie` breakdown key). */
export function cookieQtyFromItem(item) {
  return cookieQtyFromBreakdown(item?.breakdown);
}

/**
 * Per-flavor rows on a cookie line (legacy `cookie` → butterscotch).
 * @returns {{ catId: string, flavorId: string, qty: number, unitPrice: number }[]}
 */
export function cookieFlavorEntriesFromItem(item) {
  const breakdown = normalizeInventoryBreakdown(item?.breakdown);
  if (!Object.keys(breakdown).length) return [];
  const rows = [];
  for (const [catId, qtyRaw] of Object.entries(breakdown)) {
    if (!isCookieCategoryId(catId)) continue;
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const flavorId = cookieFlavorIdFromCategory(catId) || 'butterscotch';
    rows.push({
      catId,
      flavorId,
      qty,
      unitPrice: cookieUnitPrice(catId),
      wholesale: cookieWholesaleUgx(flavorId),
    });
  }
  return rows;
}

function cookieProductKind(item) {
  const id = String(item?.product_id || item?.productId || '')
    .toLowerCase()
    .replace(/-/g, '_');
  const name = String(item?.product_name || item?.name || '').toLowerCase();
  if (id.includes('quartet') || name.includes('quartet')) return 'quartet';
  if (id.includes('trio') || name.includes('trio')) return 'trio';
  if (id.includes('duet') || name.includes('duet')) return 'duet';
  return 'single';
}

/**
 * Revenue share per flavor entry on a cookie line.
 * Packs split pack price evenly per cookie; singles use ala-carte weights.
 * @returns {number[]} allocation aligned with `entries`
 */
export function allocateCookieLineRevenue(entries, revenue, productKind = 'single') {
  const list = entries || [];
  if (!list.length || revenue <= 0) return list.map(() => 0);

  if (productKind === 'quartet' || productKind === 'trio' || productKind === 'duet') {
    const totalQty = list.reduce((sum, e) => sum + e.qty, 0) || 1;
    return list.map((e) => revenue * (e.qty / totalQty));
  }

  const weightSum =
    list.reduce((sum, e) => sum + e.unitPrice * e.qty, 0) || list.reduce((s, e) => s + e.qty, 0);
  return list.map((e) => revenue * ((e.unitPrice * e.qty) / weightSum));
}

/**
 * Cookie line economics: wholesale, profit, your split, partner due (cost + their split).
 * @returns {{ cookieQty: number, revenue: number, wholesale: number, profit: number, ownerSplit: number, partnerDue: number } | null}
 */
export function itemCookieSettlement(item) {
  const entries = cookieFlavorEntriesFromItem(item);
  const cookieQty = entries.reduce((sum, e) => sum + e.qty, 0);
  if (cookieQty <= 0) return null;

  const revenue = Math.max(0, Number(item?.line_total) || 0);
  const wholesale = entries.reduce((sum, e) => sum + e.qty * e.wholesale, 0);
  const allocs = allocateCookieLineRevenue(entries, revenue, cookieProductKind(item));

  let ownerSplit = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const alloc = allocs[i];
    const cost = e.qty * e.wholesale;
    const profit = alloc - cost;
    if (profit <= 0) continue;
    ownerSplit += profit * COOKIE_OWNER_SHARE;
  }

  ownerSplit = Math.round(ownerSplit);
  const partnerDue = Math.max(0, Math.round(revenue - ownerSplit));
  return {
    cookieQty,
    revenue,
    wholesale,
    profit: revenue - wholesale,
    ownerSplit,
    partnerDue,
  };
}

/**
 * Expand a cookie line into per-unit shares (for settlement batches).
 * Amounts are scaled by `paidRatio` (credit collections).
 * Zero-revenue lines (rewards) are omitted from partner settlement.
 */
export function expandCookieUnitsFromItem(item, paidRatio = 1) {
  const entries = cookieFlavorEntriesFromItem(item);
  const cookieQty = entries.reduce((sum, e) => sum + e.qty, 0);
  if (cookieQty <= 0) return [];

  const revenue = Math.max(0, Number(item?.line_total) || 0) * paidRatio;
  if (revenue <= 0) return [];

  const kind = cookieProductKind(item);
  const allocs = allocateCookieLineRevenue(entries, revenue, kind);
  const units = [];

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const alloc = allocs[i];
    const cost = e.qty * e.wholesale * paidRatio;
    const profit = alloc - cost;
    const ownerTotal = profit > 0 ? profit * COOKIE_OWNER_SHARE : 0;
    const partnerTotal = Math.max(0, alloc - ownerTotal);
    const ownerEach = ownerTotal / e.qty;
    const partnerEach = partnerTotal / e.qty;
    for (let u = 0; u < e.qty; u += 1) {
      units.push({
        flavorId: e.flavorId,
        ownerSplit: ownerEach,
        partnerDue: partnerEach,
        revenue: alloc / e.qty,
        productKind: kind,
      });
    }
  }
  return units;
}

function flavorCountsOf(units) {
  const counts = {};
  for (const unit of units) {
    const id = unit.flavorId || 'butterscotch';
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function flavorCountsKey(counts) {
  return COOKIE_FLAVORS.map((f) => `${f.id}:${counts[f.id] || 0}`).join('|');
}

function flavorName(flavorId) {
  const named = COOKIE_FLAVORS.find((f) => f.id === flavorId);
  return (named?.name || String(flavorId || 'cookie')).toLowerCase();
}

/** "1 chocolate, 2 strawberry, 1 butterscotch" — choices first, butterscotch last. */
export function cookieFlavorMixPhrase(counts) {
  const parts = COOKIE_FLAVORS.filter((f) => f.id !== 'butterscotch' && (counts[f.id] || 0) > 0).map(
    (f) => `${counts[f.id]} ${f.name.toLowerCase()}`,
  );
  if ((counts.butterscotch || 0) > 0) parts.push(`${counts.butterscotch} butterscotch`);
  return parts.join(', ');
}

function sumUnitMoney(slice) {
  return slice.reduce(
    (acc, unit) => {
      acc.ownerSplit += unit.ownerSplit;
      acc.partnerDue += unit.partnerDue;
      acc.revenue += unit.revenue;
      return acc;
    },
    { ownerSplit: 0, partnerDue: 0, revenue: 0 },
  );
}

function fmtPlainUgx(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Group a cookie-unit slice into sold products (singles by flavor, packs by mix).
 * Complete packs stay packs; a pack split across batches shows as "2 of 4".
 */
export function cookieBatchProductLines(units) {
  const byLine = new Map();
  for (const unit of units || []) {
    const key = unit.lineKey || `${unit.saleId || 'sale'}:${unit.flavorId || 'cookie'}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(unit);
  }

  const merged = new Map();
  const addRow = (row) => {
    const key =
      row.kind === 'single'
        ? `single:${row.flavorId}`
        : `${row.kind}:${row.complete ? 'full' : 'part'}:${flavorCountsKey(row.flavorCounts)}:${row.lineCookieQty}:${Math.round(row.cookieQty / row.qty)}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += row.qty;
      existing.cookieQty += row.cookieQty;
      existing.revenue += row.revenue;
      return;
    }
    merged.set(key, { ...row, flavorCounts: { ...row.flavorCounts } });
  };

  for (const lineUnits of byLine.values()) {
    const first = lineUnits[0];
    const kind = first.productKind || 'single';
    if (kind === 'single') {
      const byFlavor = new Map();
      for (const unit of lineUnits) {
        const flavorId = unit.flavorId || 'butterscotch';
        if (!byFlavor.has(flavorId)) byFlavor.set(flavorId, []);
        byFlavor.get(flavorId).push(unit);
      }
      for (const [flavorId, flavorUnits] of byFlavor) {
        addRow({
          kind: 'single',
          flavorId,
          qty: flavorUnits.length,
          cookieQty: flavorUnits.length,
          complete: true,
          lineCookieQty: flavorUnits.length,
          flavorCounts: { [flavorId]: flavorUnits.length },
          revenue: flavorUnits.reduce((sum, unit) => sum + unit.revenue, 0),
        });
      }
      continue;
    }

    const cookieQty = lineUnits.length;
    const lineCookieQty = first.lineCookieQty || cookieQty;
    addRow({
      kind,
      flavorId: null,
      qty: 1,
      cookieQty,
      complete: cookieQty === lineCookieQty,
      lineCookieQty,
      flavorCounts: flavorCountsOf(lineUnits),
      revenue: lineUnits.reduce((sum, unit) => sum + unit.revenue, 0),
    });
  }

  const rank = (row) => {
    if (row.kind === 'single') {
      const i = COOKIE_FLAVORS.findIndex((f) => f.id === row.flavorId);
      return [0, i < 0 ? 99 : i];
    }
    if (row.kind === 'duet') return [1, row.complete ? 0 : 1];
    if (row.kind === 'trio') return [2, row.complete ? 0 : 1];
    if (row.kind === 'quartet') return [3, row.complete ? 0 : 1];
    return [3, 0];
  };

  return [...merged.values()]
    .map((row) => ({ ...row, revenue: Math.round(row.revenue) }))
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1];
    });
}

export function cookieBatchLineTitle(row) {
  if (row.kind === 'single') return flavorName(row.flavorId);
  const pack = row.kind === 'quartet' ? 'Quartet' : row.kind === 'trio' ? 'Trio' : 'Duet';
  if (!row.complete) return `${pack} · ${row.cookieQty} of ${row.lineCookieQty}`;
  return pack;
}

export function cookiePartnerBatchesFromUnits(units, every) {
  const size = Math.max(1, Number(every) || COOKIE_PARTNER_SETTLE_EVERY);
  const list = units || [];
  const batches = [];
  for (let offset = 0; offset < list.length; offset += size) {
    const slice = list.slice(offset, offset + size);
    const totals = sumUnitMoney(slice);
    batches.push({
      index: batches.length + 1,
      cookieCount: slice.length,
      every: size,
      complete: slice.length === size,
      lines: cookieBatchProductLines(slice),
      revenue: Math.round(totals.revenue),
      ownerSplit: Math.round(totals.ownerSplit),
      partnerDue: Math.round(totals.partnerDue),
    });
  }
  return batches;
}

export function cookieBatchShareText(batch) {
  if (!batch) return '';
  const lines = (batch.lines || []).map((row) => {
    const mix = row.kind === 'single' ? '' : cookieFlavorMixPhrase(row.flavorCounts);
    const title = mix ? `${row.qty} ${cookieBatchLineTitle(row)} (${mix})` : `${row.qty} ${cookieBatchLineTitle(row)}`;
    return `${title} — ${fmtPlainUgx(row.revenue)}`;
  });
  lines.push('');
  lines.push(`${batch.cookieCount} cookies — ${fmtPlainUgx(batch.revenue)}`);
  lines.push(`Your split — ${fmtPlainUgx(batch.ownerSplit)}`);
  lines.push(`Send partner — ${fmtPlainUgx(batch.partnerDue)}`);
  return lines.join('\n');
}

export function cookiePartnerShareText(batches) {
  const list = batches || [];
  if (!list.length) return '';
  return list
    .map((batch, i) => {
      const body = cookieBatchShareText(batch);
      if (list.length === 1) return body;
      const head = batch.complete
        ? `Batch ${i + 1} — ${batch.cookieCount} cookies`
        : `Next cycle — ${batch.cookieCount} of ${batch.every}`;
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

/** Chronological cookie units from the partner track-from date (oldest first). */
export function cookieUnitsChronological(sales) {
  const sorted = [...(sales || [])]
    .filter((s) => new Date(s.created_at).getTime() >= COOKIE_PARTNER_TRACK_FROM_MS)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const units = [];
  for (const sale of sorted) {
    (sale.items || []).forEach((item, itemIndex) => {
      const expanded = expandCookieUnitsFromItem(item, 1);
      const lineCookieQty = expanded.length;
      for (const unit of expanded) {
        units.push({
          ...unit,
          saleId: sale.id,
          created_at: sale.created_at,
          lineKey: `${sale.id}:${itemIndex}`,
          lineCookieQty,
        });
      }
    });
  }
  return units;
}

function readLocalSettledQty() {
  try {
    const raw = localStorage.getItem(COOKIE_SETTLE_STORAGE_KEY);
    if (raw == null || raw === '') return COOKIE_PARTNER_SETTLED_BASELINE;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    return COOKIE_PARTNER_SETTLED_BASELINE;
  } catch {
    return COOKIE_PARTNER_SETTLED_BASELINE;
  }
}

export function getCookiePartnerSettledQty() {
  return readLocalSettledQty();
}

export function setCookiePartnerSettledQty(qty) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  try {
    localStorage.setItem(COOKIE_SETTLE_STORAGE_KEY, String(n));
  } catch {
    /* ignore quota / private mode */
  }
  return n;
}

async function staffSettleToken() {
  return (
    (await window.VenusPosAuth?.getAccessToken?.().catch(() => '')) ||
    window.VenusPosAuth?.peekAccessToken?.() ||
    ''
  );
}

/** Pull settled qty from Netlify blob (shared across devices). Returns null if unavailable. */
export async function fetchCookiePartnerSettledQty() {
  try {
    const token = await staffSettleToken();
    if (!token) return null;
    const res = await fetch('/api/cookie-partner/settle', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.ok || data.settled_qty == null) return null;
    const n = Math.max(0, Math.floor(Number(data.settled_qty) || 0));
    return n;
  } catch {
    return null;
  }
}

/** Persist settled qty locally and to the shared blob store. */
export async function persistCookiePartnerSettledQty(qty) {
  const n = setCookiePartnerSettledQty(qty);
  try {
    const token = await staffSettleToken();
    if (!token) return n;
    await fetch('/api/cookie-partner/settle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ settled_qty: n }),
      cache: 'no-store',
    });
  } catch {
    /* local write still counts; sync can retry next mark */
  }
  return n;
}

/**
 * Prefer the higher of local + server, but never keep a corrupted “all cookies
 * settled” value that blanked the unpaid batch. Baseline = first paid batch.
 */
export async function syncCookiePartnerSettledQty(totalCookiesHint = 0) {
  const local = readLocalSettledQty();
  const remote = await fetchCookiePartnerSettledQty();
  const total = Math.max(0, Math.floor(Number(totalCookiesHint) || 0));
  const baseline = COOKIE_PARTNER_SETTLED_BASELINE;

  const sanitize = (n) => {
    if (!Number.isFinite(n) || n < 0) return baseline;
    const q = Math.floor(n);
    if (total > baseline && q >= total) return baseline;
    return q;
  };

  if (remote == null) {
    const fixed = sanitize(local);
    if (fixed !== local) setCookiePartnerSettledQty(fixed);
    return fixed;
  }

  let merged = Math.max(sanitize(local), sanitize(remote));
  if (total > baseline && merged >= total) merged = baseline;

  if (merged !== local) setCookiePartnerSettledQty(merged);
  if (merged !== remote) {
    try {
      await persistCookiePartnerSettledQty(merged);
    } catch {
      /* keep merged local */
    }
  }
  return merged;
}

/**
 * Partner settlement snapshot: progress toward every N cookies, your split, amount to send.
 * Only the *next* complete batch is "ready" — further complete batches stay queued.
 */
export function cookiePartnerSettlementSummary(sales) {
  const units = cookieUnitsChronological(sales);
  const totalCookies = units.length;
  const settledRaw = getCookiePartnerSettledQty();
  let settledQty = settledRaw;
  if (totalCookies > 0 && settledQty > totalCookies) settledQty = totalCookies;
  if (totalCookies > COOKIE_PARTNER_SETTLED_BASELINE && settledRaw >= totalCookies) {
    settledQty = COOKIE_PARTNER_SETTLED_BASELINE;
    setCookiePartnerSettledQty(COOKIE_PARTNER_SETTLED_BASELINE);
  }

  const unsettled = units.slice(settledQty);
  const settledUnits = units.slice(0, settledQty);
  const unsettledCount = unsettled.length;
  const every = COOKIE_PARTNER_SETTLE_EVERY;
  const readyBatches = Math.floor(unsettledCount / every);
  const readyCount = readyBatches > 0 ? every : 0;
  const queuedReadyBatches = Math.max(0, readyBatches - 1);
  const progressInCycle = unsettledCount % every;
  const towardNext = readyBatches > 0 ? every : progressInCycle;

  const sumSlice = (slice) =>
    slice.reduce(
      (acc, u) => {
        acc.ownerSplit += u.ownerSplit;
        acc.partnerDue += u.partnerDue;
        acc.revenue += u.revenue;
        return acc;
      },
      { ownerSplit: 0, partnerDue: 0, revenue: 0 },
    );

  const unsettledTotals = sumSlice(unsettled);
  const readySlice = readyCount > 0 ? unsettled.slice(0, readyCount) : [];
  const readyTotals = sumSlice(readySlice);

  const lifetime = units.reduce(
    (acc, u) => {
      acc.ownerSplit += u.ownerSplit;
      acc.partnerDue += u.partnerDue;
      acc.revenue += u.revenue;
      return acc;
    },
    { ownerSplit: 0, partnerDue: 0, revenue: 0 },
  );

  const settledBatches = cookiePartnerBatchesFromUnits(settledUnits, every).map((b, i) => ({
    ...b,
    status: 'sent',
    historyIndex: i + 1,
  }));
  const openBatches = cookiePartnerBatchesFromUnits(unsettled, every).map((b, i) => ({
    ...b,
    status: b.complete ? (i === 0 ? 'ready' : 'queued') : 'progress',
    historyIndex: settledBatches.length + i + 1,
  }));
  const pages = [...settledBatches, ...openBatches];

  return {
    every,
    totalCookies,
    settledQty,
    unsettledCount,
    readyBatches,
    readyCount,
    queuedReadyBatches,
    towardNext,
    batchOwnerSplit: Math.round(unsettledTotals.ownerSplit),
    batchPartnerDue: Math.round(unsettledTotals.partnerDue),
    batchRevenue: Math.round(unsettledTotals.revenue),
    readyOwnerSplit: Math.round(readyTotals.ownerSplit),
    readyPartnerDue: Math.round(readyTotals.partnerDue),
    readyRevenue: Math.round(readyTotals.revenue),
    lifetimeOwnerSplit: Math.round(lifetime.ownerSplit),
    lifetimePartnerDue: Math.round(lifetime.partnerDue),
    lifetimeRevenue: Math.round(lifetime.revenue),
    batches: openBatches,
    settledBatches,
    pages,
    currentPageIndex: settledBatches.length,
  };
}

/** Mark only the next complete settlement batch as sent to partner. */
export async function markCookiePartnerBatchesSent(sales) {
  const summary = cookiePartnerSettlementSummary(sales);
  if (summary.readyCount <= 0) return summary;
  await persistCookiePartnerSettledQty(summary.settledQty + summary.readyCount);
  return cookiePartnerSettlementSummary(sales);
}

/**
 * Owner revenue for a line: cookies at your profit split only; everything else at face value.
 * Customer still pays full unit price — this is for analytics, not checkout totals.
 */
export function itemOwnerRevenue(item) {
  const settlement = itemCookieSettlement(item);
  if (settlement) return settlement.ownerSplit;
  return Number(item?.line_total) || 0;
}

/**
 * Owner revenue split across flavors in a line (qty-weighted joints; cookie profit split).
 * @returns {{ catId: string, qty: number, revenue: number }[]}
 */
export function itemFlavorOwnerShares(item) {
  const entries = cookieFlavorEntriesFromItem(item);
  if (entries.length) {
    const revenue = Math.max(0, Number(item?.line_total) || 0);
    const allocs = allocateCookieLineRevenue(entries, revenue, cookieProductKind(item));
    return entries.map((e, i) => {
      const alloc = allocs[i];
      const cost = e.qty * e.wholesale;
      const profit = alloc - cost;
      return {
        catId: e.catId,
        qty: e.qty,
        revenue: profit > 0 ? profit * COOKIE_OWNER_SHARE : 0,
      };
    });
  }

  const breakdown = normalizeInventoryBreakdown(item?.breakdown);
  const jointEntries = Object.entries(breakdown).filter(([catId, qty]) => {
    if (isCookieCategoryId(catId)) return false;
    return Number.isFinite(qty) && qty > 0;
  });
  const totalQty = jointEntries.reduce((sum, [, qty]) => sum + qty, 0);
  if (!totalQty) return [];
  const lineRev = Math.max(0, Number(item?.line_total) || 0);
  return jointEntries.map(([catId, qty]) => ({
    catId,
    qty,
    revenue: lineRev * (qty / totalQty),
  }));
}

/** Full owner revenue for a sale (ignores credit settlement). */
export function saleOwnerRevenue(sale) {
  const items = sale?.items;
  if (!items?.length) return Number(sale?.total_ugx) || 0;
  return items.reduce((sum, item) => sum + itemOwnerRevenue(item), 0);
}

/**
 * Share of a credit sale that has been collected (0–1).
 * Cash sales and fully cleared credit count as 1.
 */
export function salePaidRatio(sale) {
  if (!sale?.is_credit) return 1;
  if (sale.credit_cleared) return 1;
  const total = Number(sale.total_ugx) || 0;
  if (total <= 0) return 0;
  const paid = Math.min(Math.max(0, Number(sale.amount_paid_ugx) || 0), total);
  return paid / total;
}

/** Owner revenue recognized so far (excludes unpaid credit balance). */
export function saleRecognizedOwnerRevenue(sale) {
  return saleOwnerRevenue(sale) * salePaidRatio(sale);
}

export function sumOwnerRevenue(list) {
  return list.reduce((sum, s) => sum + saleRecognizedOwnerRevenue(s), 0);
}
