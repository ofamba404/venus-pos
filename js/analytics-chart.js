import { animateRevenueChart } from './animations.js';
import { revenueChartPlaceholder, salesPatternsPlaceholder, showPlaceholder } from './pending.js';
import { isOutstandingCredit } from './credit.js';
import {
  saleOwnerRevenue,
  saleRecognizedOwnerRevenue,
  sumOwnerRevenue,
} from './revenue.js';
import { fmtCompact, fmtUGX, isSameDay } from './utils.js';

/** Calendar ranges: weeks = Mon–Sun, months = calendar months. `offset` = complete weeks ago (1 = last week). */
export const CHART_RANGES = [
  { id: '1w', label: 'This week', short: '1W', unit: 'week', count: 1 },
  { id: 'lw', label: 'Last week', short: 'LW', unit: 'week', count: 1, offset: 1 },
  { id: '2w', label: 'Last 2 weeks', short: '2W', unit: 'week', count: 2 },
  { id: '1m', label: 'This month', short: '1M', unit: 'month', count: 1 },
  { id: '3m', label: 'Last 3 months', short: '3M', unit: 'month', count: 3 },
  { id: 'all', label: 'All time', short: 'All', unit: null, count: null },
];

/** Shared period for Customer favorite, Revenue by product, and Top clients. */
export const INSIGHT_PERIODS = [
  { id: 'week', label: 'Week', short: 'Week', unit: 'week', count: 1 },
  { id: 'month', label: 'Month', short: 'Month', unit: 'month', count: 1 },
  { id: 'all', label: 'All time', short: 'All', unit: null, count: null },
];

const RANGE_KEY = 'venus_chart_range';
const INSIGHT_PERIOD_KEY = 'venus_insight_period';

export function getChartRange() {
  const saved = sessionStorage.getItem(RANGE_KEY);
  return CHART_RANGES.find((r) => r.id === saved) || CHART_RANGES[0];
}

export function setChartRange(id) {
  sessionStorage.setItem(RANGE_KEY, id);
}

export function getInsightPeriod() {
  const saved = sessionStorage.getItem(INSIGHT_PERIOD_KEY);
  return INSIGHT_PERIODS.find((p) => p.id === saved) || INSIGHT_PERIODS.find((p) => p.id === 'month');
}

export function setInsightPeriod(id) {
  sessionStorage.setItem(INSIGHT_PERIOD_KEY, id);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Monday 00:00 of the calendar week containing `d`. */
export function mondayOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const offset = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - offset);
  return x;
}

/** Inclusive start/end for a chart range (calendar weeks / months). */
export function rangeBounds(range, now = new Date()) {
  if (!range.unit) return null;
  if (range.unit === 'week') {
    const thisMon = mondayOfWeek(now);
    const offset = range.offset || 0;
    if (offset > 0) {
      const start = new Date(thisMon);
      start.setDate(start.getDate() - offset * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + range.count * 7 - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = new Date(thisMon);
    start.setDate(start.getDate() - (range.count - 1) * 7);
    return { start, end: endOfDay(now) };
  }
  if (range.unit === 'month') {
    const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - (range.count - 1), 1));
    return { start, end: endOfDay(now) };
  }
  return null;
}

export function filterSalesByRange(sales, range) {
  const bounds = rangeBounds(range);
  if (!bounds) return sales;
  return sales.filter((s) => {
    const d = new Date(s.created_at);
    return d >= bounds.start && d <= bounds.end;
  });
}

export function filterSalesByInsightPeriod(sales, period) {
  return filterSalesByRange(sales, period || getInsightPeriod());
}

function bucketLabel(date, mode) {
  if (mode === 'weekday') {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  if (mode === 'short') {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (mode === 'tiny') {
    return String(date.getDate());
  }
  if (mode === 'month') {
    return date.toLocaleDateString(undefined, { month: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function salesForDay(sales, day) {
  return sales.filter((s) => isSameDay(new Date(s.created_at), day));
}

function sumRevenue(list) {
  return sumOwnerRevenue(list);
}

function daysBetweenInclusive(start, end) {
  const a = startOfDay(start);
  const b = startOfDay(end);
  return Math.round((b - a) / 86400000) + 1;
}

function buildDailyBuckets(sales, start, count, labelMode) {
  const buckets = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const daySales = salesForDay(sales, d);
    buckets.push({
      date: d,
      label: bucketLabel(d, labelMode),
      revenue: sumRevenue(daySales),
      orders: daySales.length,
    });
  }
  return buckets;
}

function buildWeeklyBuckets(sales, start, end) {
  const buckets = [];
  let cursor = mondayOfWeek(start);
  const endDay = startOfDay(end);
  while (cursor <= endDay) {
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const weekSales = sales.filter((s) => {
      const d = new Date(s.created_at);
      return d >= cursor && d <= weekEnd && d <= end;
    });
    buckets.push({
      date: new Date(cursor),
      label: bucketLabel(cursor, 'short'),
      revenue: sumRevenue(weekSales),
      orders: weekSales.length,
    });
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 7);
  }
  return buckets;
}

function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function buildTimeSeries(sales, range) {
  const now = new Date();
  const bounds = rangeBounds(range, now);

  if (bounds) {
    const { start, end } = bounds;
    const count = daysBetweenInclusive(start, end);

    if (range.unit === 'week') {
      const labelMode = range.count === 1 ? 'weekday' : 'short';
      return buildDailyBuckets(sales, start, count, labelMode);
    }

    if (range.unit === 'month' && range.count === 1) {
      return buildDailyBuckets(sales, start, count, count <= 10 ? 'weekday' : 'tiny');
    }

    if (range.unit === 'month') {
      return buildWeeklyBuckets(sales, start, end);
    }
  }

  if (!sales.length) return [];

  const dates = sales.map((s) => new Date(s.created_at));
  const minDate = startOfDay(new Date(Math.min(...dates)));
  const maxDate = startOfDay(now);
  const spanDays = daysBetweenInclusive(minDate, maxDate);

  if (spanDays <= 45) {
    return buildDailyBuckets(sales, minDate, spanDays, 'short');
  }

  if (spanDays <= 200) {
    return buildWeeklyBuckets(sales, minDate, maxDate);
  }

  const monthMap = new Map();
  sales.forEach((s) => {
    const d = new Date(s.created_at);
    const key = monthKey(d);
    if (!monthMap.has(key)) {
      monthMap.set(key, {
        date: startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)),
        revenue: 0,
        orders: 0,
      });
    }
    const b = monthMap.get(key);
    b.revenue += saleRecognizedOwnerRevenue(s);
    b.orders += 1;
  });
  return Array.from(monthMap.values())
    .sort((a, b) => a.date - b.date)
    .map((b) => ({
      ...b,
      label: b.date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
    }));
}

function priorBounds(range, now = new Date()) {
  if (!range.unit) return null;

  if (range.unit === 'week') {
    const current = rangeBounds(range, now);
    if (!current) return null;
    const priorEnd = new Date(current.start);
    priorEnd.setDate(priorEnd.getDate() - 1);
    priorEnd.setHours(23, 59, 59, 999);
    const priorStart = mondayOfWeek(priorEnd);
    priorStart.setDate(priorStart.getDate() - (range.count - 1) * 7);
    return { start: priorStart, end: priorEnd };
  }

  if (range.unit === 'month') {
    const curStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - (range.count - 1), 1));
    const priorEnd = endOfDay(new Date(curStart.getFullYear(), curStart.getMonth(), 0));
    const priorStart = startOfDay(
      new Date(priorEnd.getFullYear(), priorEnd.getMonth() - (range.count - 1), 1),
    );
    return { start: priorStart, end: priorEnd };
  }

  return null;
}

export function priorPeriodComparison(sales, range) {
  const currentBounds = rangeBounds(range);
  if (!currentBounds) return null;

  const current = filterSalesByRange(sales, range);
  const currentTotal = sumRevenue(current);

  const prior = priorBounds(range);
  if (!prior) return null;

  const priorSales = sales.filter((s) => {
    const d = new Date(s.created_at);
    return d >= prior.start && d <= prior.end;
  });
  const priorTotal = sumRevenue(priorSales);

  if (priorTotal === 0 && currentTotal === 0) {
    return { text: 'No change vs prior period', cls: 'neutral', pct: 0 };
  }
  if (priorTotal === 0) {
    return { text: 'Up from prior period', cls: 'up', pct: null };
  }
  const pct = Math.round(((currentTotal - priorTotal) / priorTotal) * 100);
  if (pct === 0) return { text: 'Flat vs prior period', cls: 'neutral', pct: 0 };
  if (pct > 0) return { text: `+${pct}% vs prior ${range.short}`, cls: 'up', pct };
  return { text: `${pct}% vs prior ${range.short}`, cls: 'down', pct };
}

function smoothPath(points) {
  if (points.length < 2) return points.length ? `M ${points[0].x} ${points[0].y}` : '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function formatAxisValue(n, max) {
  if (max >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (max >= 10000) return `${Math.round(n / 1000)}k`;
  if (max >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function buildChartSvg(buckets) {
  const W = 360;
  const H = 200;
  const pad = { t: 16, r: 12, b: 32, l: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  if (!buckets.length) {
    return {
      html: `<div class="rev-chart-empty">No data for this period</div>`,
      points: [],
    };
  }

  const maxRev = Math.max(1, ...buckets.map((b) => b.revenue));
  const n = buckets.length;

  const points = buckets.map((b, i) => {
    const x = pad.l + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
    const y = pad.t + innerH - (b.revenue / maxRev) * innerH;
    return { x, y, ...b };
  });

  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? pad.l} ${pad.t + innerH} L ${points[0]?.x ?? pad.l} ${pad.t + innerH} Z`;

  const gridLines = [0, 0.5, 1].map((pct) => {
    const y = pad.t + innerH * (1 - pct);
    const val = maxRev * pct;
    return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" class="rev-grid-line"/>
      <text x="${pad.l - 6}" y="${y + 4}" class="rev-axis-label" text-anchor="end">${formatAxisValue(val, maxRev)}</text>`;
  });

  const step = n > 1 ? innerW / (n - 1) : innerW;
  const hitW = Math.max(8, step * 0.85);

  const dots = points
    .map(
      (p, i) => `
    <g class="rev-point" data-idx="${i}" tabindex="0" role="button" aria-label="${p.label}: ${fmtUGX(p.revenue)}">
      <rect class="rev-hit" x="${p.x - hitW / 2}" y="${pad.t}" width="${hitW}" height="${innerH}" rx="4"/>
      <circle class="rev-dot" cx="${p.x}" cy="${p.y}" r="4"/>
      <circle class="rev-dot-glow" cx="${p.x}" cy="${p.y}" r="8"/>
    </g>`,
    )
    .join('');

  const labelEvery = n <= 8 ? 1 : n <= 16 ? 2 : n <= 45 ? 5 : Math.ceil(n / 6);
  const xLabels = points
    .filter((_, i) => i % labelEvery === 0 || i === n - 1)
    .map((p) => `<text x="${p.x}" y="${H - 8}" class="rev-x-label" text-anchor="middle">${p.label}</text>`)
    .join('');

  const uid = `rev-grad-${Date.now()}`;

  return {
    html: `<svg class="rev-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--jade)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="var(--jade)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${gridLines.join('')}
      <path class="rev-area" d="${areaPath}" fill="url(#${uid})"/>
      <path class="rev-line" d="${linePath}"/>
      ${dots}
      ${xLabels}
    </svg>`,
    points,
  };
}

function wireChartInteraction(block, points) {
  const tooltip = block.querySelector('.rev-tooltip');
  const tooltipDate = block.querySelector('.rev-tooltip-date');
  const tooltipVal = block.querySelector('.rev-tooltip-orders');
  const tooltipAmt = block.querySelector('.rev-tooltip-amt');
  if (!tooltip) return;

  let active = null;

  const show = (idx) => {
    const p = points[idx];
    if (!p) return;
    active = idx;
    block.querySelectorAll('.rev-point').forEach((el, i) => el.classList.toggle('active', i === idx));
    tooltipDate.textContent = p.date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    tooltipAmt.textContent = fmtUGX(p.revenue);
    tooltipVal.textContent = `${p.orders} order${p.orders === 1 ? '' : 's'}`;
    tooltip.hidden = false;

    const svg = block.querySelector('.rev-chart-svg');
    const rect = svg.getBoundingClientRect();
    const pct = points.length > 1 ? idx / (points.length - 1) : 0.5;
    const x = pct * rect.width;
    tooltip.style.left = `${Math.min(Math.max(x, 48), rect.width - 48)}px`;
  };

  const hide = () => {
    active = null;
    tooltip.hidden = true;
    block.querySelectorAll('.rev-point').forEach((el) => el.classList.remove('active'));
  };

  block.querySelectorAll('.rev-point').forEach((el) => {
    const idx = parseInt(el.dataset.idx, 10);
    el.addEventListener('mouseenter', () => show(idx));
    el.addEventListener('focus', () => show(idx));
    el.addEventListener('click', () => (active === idx ? hide() : show(idx)));
  });

  block.querySelector('.rev-chart-wrap')?.addEventListener('mouseleave', hide);
}

export function renderRevenueChart(block, sales, range, onRangeChange) {
  if (!block) return;
  if (showPlaceholder('sales', sales.length)) {
    block.innerHTML = revenueChartPlaceholder();
    return;
  }
  const buckets = buildTimeSeries(sales, range);
  const rangeSales = range.unit ? filterSalesByRange(sales, range) : sales;
  const total = sumRevenue(rangeSales);
  const orders = rangeSales.length;
  const avgDay = buckets.length ? total / buckets.length : 0;
  const best = buckets.reduce((a, b) => (b.revenue > a.revenue ? b : a), buckets[0] || { revenue: 0, label: '—' });
  const comparison = priorPeriodComparison(sales, range);
  const { html: svgHtml, points } = buildChartSvg(buckets);

  const pills = CHART_RANGES.map(
    (r) =>
      `<button type="button" class="rev-range-btn${r.id === range.id ? ' active' : ''}" data-range="${r.id}">${r.short}</button>`,
  ).join('');

  block.innerHTML = `
    <div class="rev-chart-card">
      <div class="rev-chart-head">
        <div>
          <div class="rev-chart-title">Revenue</div>
          <div class="rev-chart-sub">${range.label}${comparison ? ` · <span class="rev-compare ${comparison.cls}">${comparison.text}</span>` : ''}</div>
        </div>
        <div class="rev-range-pills" role="group" aria-label="Chart time range">${pills}</div>
      </div>
      <div class="rev-stats">
        <div class="rev-stat"><span class="rev-stat-val">${fmtCompact(total)}</span><span class="rev-stat-lbl">Total</span></div>
        <div class="rev-stat"><span class="rev-stat-val">${fmtCompact(avgDay)}</span><span class="rev-stat-lbl">Avg / period</span></div>
        <div class="rev-stat"><span class="rev-stat-val">${orders}</span><span class="rev-stat-lbl">Orders</span></div>
        <div class="rev-stat"><span class="rev-stat-val">${best.revenue > 0 ? fmtCompact(best.revenue) : '—'}</span><span class="rev-stat-lbl">Peak · ${best.label || '—'}</span></div>
      </div>
      <div class="rev-chart-wrap">
        ${svgHtml}
        <div class="rev-tooltip" hidden>
          <div class="rev-tooltip-date"></div>
          <div class="rev-tooltip-amt"></div>
          <div class="rev-tooltip-orders"></div>
        </div>
      </div>
    </div>`;

  block.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.range;
      if (id === range.id) return;
      setChartRange(id);
      onRangeChange?.();
    });
  });

  wireChartInteraction(block, points);
  animateRevenueChart(block);
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function computeSalesPatterns(sales) {
  const hours = Array(24).fill(0);
  const hourOrders = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  const weekdayOrders = Array(7).fill(0);
  let creditRevenue = 0;
  let paidRevenue = 0;
  let joints = 0;
  let cookies = 0;

  sales.forEach((s) => {
    const d = new Date(s.created_at);
    const h = d.getHours();
    const wd = d.getDay();
    const recognized = saleRecognizedOwnerRevenue(s);
    const full = saleOwnerRevenue(s);
    hours[h] += recognized;
    hourOrders[h] += 1;
    weekdays[wd] += recognized;
    weekdayOrders[wd] += 1;
    // Settled credit counts as paid; only open AR stays in the credit bucket.
    if (isOutstandingCredit(s)) {
      paidRevenue += recognized;
      creditRevenue += Math.max(0, full - recognized);
    } else {
      paidRevenue += recognized;
    }
    (s.items || []).forEach((item) => {
      Object.entries(item.breakdown || {}).forEach(([id, qty]) => {
        if (id === 'cookie') cookies += qty;
        else joints += qty;
      });
    });
  });

  const peakHour = hours.reduce((best, v, i) => (v > best.v ? { v, i } : best), { v: 0, i: 0 });
  const peakWeekday = weekdays.reduce((best, v, i) => (v > best.v ? { v, i } : best), { v: 0, i: 0 });
  const totalPay = paidRevenue + creditRevenue;
  const creditPct = totalPay > 0 ? Math.round((creditRevenue / totalPay) * 100) : 0;
  const unitTotal = joints + cookies;

  const activeHours = hours
    .map((rev, h) => ({ h, rev, orders: hourOrders[h] }))
    .filter((x) => x.rev > 0 || x.orders > 0);
  const minH = activeHours.length ? Math.min(...activeHours.map((x) => x.h)) : 8;
  const maxH = activeHours.length ? Math.max(...activeHours.map((x) => x.h)) : 22;
  const hourSlice = [];
  for (let h = Math.max(0, minH - 1); h <= Math.min(23, maxH + 1); h++) {
    hourSlice.push({ h, rev: hours[h], orders: hourOrders[h] });
  }

  return {
    hours: hourSlice.length
      ? hourSlice
      : hours
          .map((rev, h) => ({ h, rev, orders: hourOrders[h] }))
          .slice(8, 23),
    weekdays: weekdays.map((rev, i) => ({ day: WEEKDAY_NAMES[i], rev, orders: weekdayOrders[i] })),
    peakHour,
    peakWeekday,
    creditPct,
    creditRevenue,
    paidRevenue,
    joints,
    cookies,
    unitTotal,
  };
}

function formatHour(h) {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

export function renderSalesPatterns(container, sales) {
  if (!container) return;
  const p = computeSalesPatterns(sales);

  if (!sales.length) {
    container.innerHTML = showPlaceholder('sales', sales.length)
      ? salesPatternsPlaceholder()
      : `<div class="receipt-empty">No sales yet</div>`;
    return;
  }

  const maxHour = Math.max(1, ...p.hours.map((x) => x.rev));
  const maxWd = Math.max(1, ...p.weekdays.map((x) => x.rev));
  const peakHourLabel = p.peakHour.v > 0 ? formatHour(p.peakHour.i) : '—';
  const peakDayLabel = p.peakWeekday.v > 0 ? WEEKDAY_NAMES[p.peakWeekday.i] : '—';

  const hourBars = p.hours
    .map(
      (x) => `
    <div class="pattern-bar-col" title="${formatHour(x.h)}: ${fmtUGX(x.rev)}">
      <div class="pattern-bar-track"><div class="pattern-bar-fill hour" style="height:${Math.round((x.rev / maxHour) * 100)}%"></div></div>
      <span class="pattern-bar-lbl">${x.h % 3 === 0 || x.h === p.peakHour.i ? formatHour(x.h) : ''}</span>
    </div>`,
    )
    .join('');

  const wdBars = p.weekdays
    .map(
      (x, i) => `
    <div class="pattern-bar-col${i === p.peakWeekday.i ? ' peak' : ''}" title="${x.day}: ${fmtUGX(x.rev)}">
      <div class="pattern-bar-track"><div class="pattern-bar-fill day" style="height:${Math.round((x.rev / maxWd) * 100)}%"></div></div>
      <span class="pattern-bar-lbl">${x.day}</span>
    </div>`,
    )
    .join('');

  const jointPct = p.unitTotal > 0 ? Math.round((p.joints / p.unitTotal) * 100) : 0;
  const cookiePct = p.unitTotal > 0 ? 100 - jointPct : 0;

  container.innerHTML = `
    <div class="pattern-grid">
      <div class="pattern-card">
        <div class="pattern-card-head">
          <span class="pattern-title">Peak hours</span>
          <span class="pattern-hint">${peakHourLabel} busiest</span>
        </div>
        <div class="pattern-bars vertical">${hourBars}</div>
      </div>
      <div class="pattern-card">
        <div class="pattern-card-head">
          <span class="pattern-title">By weekday</span>
          <span class="pattern-hint">${peakDayLabel} tops</span>
        </div>
        <div class="pattern-bars vertical">${wdBars}</div>
      </div>
      <div class="pattern-card pattern-mix">
        <div class="pattern-card-head">
          <span class="pattern-title">Payment mix</span>
          <span class="pattern-hint">${p.creditPct}% open credit</span>
        </div>
        <div class="mix-bar">
          <div class="mix-paid" style="width:${100 - p.creditPct}%"></div>
          <div class="mix-credit" style="width:${p.creditPct}%"></div>
        </div>
        <div class="mix-legend">
          <span><i class="mix-dot paid"></i>Collected ${fmtCompact(p.paidRevenue)}</span>
          <span><i class="mix-dot credit"></i>Open ${fmtCompact(p.creditRevenue)}</span>
        </div>
        <div class="pattern-card-head" style="margin-top:14px">
          <span class="pattern-title">Units sold</span>
          <span class="pattern-hint">${p.unitTotal} total</span>
        </div>
        <div class="mix-bar units">
          <div class="mix-joints" style="width:${jointPct}%"></div>
          <div class="mix-cookies" style="width:${cookiePct}%"></div>
        </div>
        <div class="mix-legend">
          <span><i class="mix-dot joints"></i>Joints ${p.joints}</span>
          <span><i class="mix-dot cookies"></i>Cookies ${p.cookies}</span>
        </div>
      </div>
    </div>`;
}
