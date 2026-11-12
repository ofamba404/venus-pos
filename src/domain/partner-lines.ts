/**
 * Cookie-partner batch lines and the clipboard text.
 * Port of the pure helpers in `legacy/js/revenue.js`.
 */
import { COOKIE_FLAVORS } from './catalog';

export type CookieUnit = {
  flavorId?: string;
  revenue?: number;
  ownerSplit?: number;
  partnerDue?: number;
  productKind?: string;
  lineKey?: string;
  saleId?: string;
  lineCookieQty?: number;
};

export type PartnerProductLine = {
  kind: string;
  flavorId: string | null;
  qty: number;
  cookieQty: number;
  complete: boolean;
  lineCookieQty: number;
  flavorCounts: Record<string, number>;
  revenue: number;
};

function flavorCountsOf(units: CookieUnit[]) {
  const counts: Record<string, number> = {};
  for (const unit of units) {
    const id = unit.flavorId || 'butterscotch';
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function flavorCountsKey(counts: Record<string, number>) {
  return COOKIE_FLAVORS.map((f) => `${f.id}:${counts[f.id] || 0}`).join('|');
}

function flavorName(flavorId: string | null | undefined) {
  const named = COOKIE_FLAVORS.find((f) => f.id === flavorId);
  return (named?.name || String(flavorId || 'cookie')).toLowerCase();
}

/** "1 chocolate, 2 strawberry, 1 butterscotch" — choices first, butterscotch last. */
export function cookieFlavorMixPhrase(counts: Record<string, number> | null | undefined) {
  const bag = counts || {};
  const parts = COOKIE_FLAVORS.filter((f) => f.id !== 'butterscotch' && (bag[f.id] || 0) > 0).map(
    (f) => `${bag[f.id]} ${f.name.toLowerCase()}`,
  );
  if ((bag.butterscotch || 0) > 0) parts.push(`${bag.butterscotch} butterscotch`);
  return parts.join(', ');
}

export function cookieBatchProductLines(units: CookieUnit[] | null | undefined): PartnerProductLine[] {
  const byLine = new Map<string, CookieUnit[]>();
  for (const unit of units || []) {
    const key = unit.lineKey || `${unit.saleId || 'sale'}:${unit.flavorId || 'cookie'}`;
    const list = byLine.get(key);
    if (list) list.push(unit);
    else byLine.set(key, [unit]);
  }

  const merged = new Map<string, PartnerProductLine>();
  const addRow = (row: PartnerProductLine) => {
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
    if (!first) continue;
    const kind = first.productKind || 'single';
    if (kind === 'single') {
      const byFlavor = new Map<string, CookieUnit[]>();
      for (const unit of lineUnits) {
        const flavorId = unit.flavorId || 'butterscotch';
        const list = byFlavor.get(flavorId);
        if (list) list.push(unit);
        else byFlavor.set(flavorId, [unit]);
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
          revenue: flavorUnits.reduce((sum, unit) => sum + (Number(unit.revenue) || 0), 0),
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
      revenue: lineUnits.reduce((sum, unit) => sum + (Number(unit.revenue) || 0), 0),
    });
  }

  const rank = (row: PartnerProductLine): [number, number] => {
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

export function cookieBatchLineTitle(row: {
  kind?: string;
  flavorId?: string | null;
  complete?: boolean;
  cookieQty?: number;
  lineCookieQty?: number;
}) {
  if (row.kind === 'single') return flavorName(row.flavorId);
  const pack = row.kind === 'quartet' ? 'Quartet' : row.kind === 'trio' ? 'Trio' : 'Duet';
  if (!row.complete) return `${pack} · ${row.cookieQty} of ${row.lineCookieQty}`;
  return pack;
}

function fmtPlainUgx(n: number) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function cookieBatchShareText(
  batch: {
    lines?: PartnerProductLine[] | null;
    cookieCount?: number;
    revenue?: number;
    ownerSplit?: number;
    partnerDue?: number;
  } | null,
): string {
  if (!batch) return '';
  const lines = (batch.lines || []).map((row) => {
    const mix = row.kind === 'single' ? '' : cookieFlavorMixPhrase(row.flavorCounts);
    const title = mix
      ? `${row.qty} ${cookieBatchLineTitle(row)} (${mix})`
      : `${row.qty} ${cookieBatchLineTitle(row)}`;
    return `${title} — ${fmtPlainUgx(row.revenue)}`;
  });
  lines.push('');
  lines.push(`${batch.cookieCount} cookies — ${fmtPlainUgx(Number(batch.revenue) || 0)}`);
  lines.push(`Your split — ${fmtPlainUgx(Number(batch.ownerSplit) || 0)}`);
  lines.push(`Send partner — ${fmtPlainUgx(Number(batch.partnerDue) || 0)}`);
  return lines.join('\n');
}

export function cookiePartnerShareText(
  batches: Array<Parameters<typeof cookieBatchShareText>[0] & { complete?: boolean; cookieCount?: number; every?: number }> | null | undefined,
): string {
  const list = batches || [];
  if (!list.length) return '';
  return list
    .map((batch, i) => {
      const body = cookieBatchShareText(batch);
      if (list.length === 1) return body;
      const head = batch?.complete
        ? `Batch ${i + 1} — ${batch.cookieCount} cookies`
        : `Next cycle — ${batch?.cookieCount} of ${batch?.every}`;
      return `${head}\n${body}`;
    })
    .join('\n\n');
}
