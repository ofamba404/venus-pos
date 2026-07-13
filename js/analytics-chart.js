import { fmtCompact, fmtUGX, isSameDay } from './utils.js';
import { revenueChartPlaceholder, salesPatternsPlaceholder, showPlaceholder } from './pending.js';

export const CHART_RANGES = [
  { id: '7', label: '7 days', short: '7D', days: 7 },
  { id: '14', label: '14 days', short: '14D', days: 14 },
  { id: '30', label: '30 days', short: '30D', days: 30 },
  { id: '90', label: '90 days', short: '90D', days: 90 },
  { id: 'all', label: 'All time', short: 'All', days: null },
];

const RANGE_KEY = 'venus_chart_range';

export function getChartRange() {
  const saved = sessionStorage.getItem(RANGE_KEY);
  return CHART_RANGES.find((r) => r.id === saved) || CHART_RANGES[0];
}

export function setChartRange(id) {
  sessionStorage.setItem(RANGE_KEY, id);
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

export function filterSalesByRange(sales, range) {
  if (!range.days) return sales;
  const end = endOfDay(new Date());
  const start = startOfDay(new Date());
  start.setDate(start.getDate() - (range.days - 1));
  return sales.filter((s) => {
    const d = new Date(s.created_at);
    return d >= start && d <= end;
  });
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
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function salesForDay(sales, day) {
  return sales.filter((s) => isSameDay(new Date(s.created_at), day));
}

function sumRevenue(list) {
  return list.reduce((sum, s) => sum + s.total_ugx, 0);
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

function weekStart(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function buildTimeSeries(sales, range) {
  if (!sales.length) {
    if (range.days) {
      const start = startOfDay(new Date());
      start.setDate(start.getDate() - (range.days - 1));
      return buildDailyBuckets([], start, range.days, range.days <= 7 ? 'weekday' : 'short');
    }
    return [];
  }

  if (range.days) {
    const start = startOfDay(new Date());
    start.setDate(start.getDate() - (range.days - 1));
    const labelMode = range.days <= 7 ? 'weekday' : range.days <= 30 ? 'short' : 'tiny';
    return buildDailyBuckets(sales, start, range.days, labelMode);
  }

  const dates = sales.map((s) => new Date(s.created_at));
  const minDate = startOfDay(new Date(Math.min(...dates)));
  const maxDate = startOfDay(new Date());
  const spanDays = Math.ceil((maxDate - minDate) / 86400000) + 1;

  if (spanDays <= 45) {
    return buildDailyBuckets(sales, minDate, spanDays, 'short');
  }

  if (spanDays <= 200) {
    const buckets = [];
    let cursor = weekStart(minDate);
    while (cursor <= maxDate) {
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const weekSales = sales.filter((s) => {
        const d = new Date(s.created_at);
        return d >= cursor && d <= weekEnd;
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

  const monthMap = new Map();
  sales.forEach((s) => {
    const d = new Date(s.created_at);
    const key = monthKey(d);
    if (!monthMap.has(key)) {
      monthMap.set(key, { date: startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)), revenue: 0, orders: 0 });
    }
    const b = monthMap.get(key);
    b.revenue += s.total_ugx;
    b.orders += 1;
  });
  return Array.from(monthMap.values())
    .sort((a, b) => a.date - b.date)
    .map((b) => ({
      ...b,
      label: b.date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
    }));
}

export function priorPeriodComparison(sales, range) {
  if (!range.days) return null;
  const current = filterSalesByRange(sales, range);
  const currentTotal = sumRevenue(current);

  const priorEnd = startOfDay(new Date());
  priorEnd.setDate(priorEnd.getDate() - range.days);
  priorEnd.setHours(23, 59, 59, 999);
  const priorStart = startOfDay(new Date(priorEnd));
  priorStart.setDate(priorStart.getDate() - (range.days - 1));

  const prior = sales.filter((s) => {
    const d = new Date(s.created_at);
    return d >= priorStart && d <= priorEnd;
  });
  const priorTotal = sumRevenue(prior);

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
    tooltipDate.textContent = p.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  const rangeSales = range.days ? filterSalesByRange(sales, range) : sales;
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
    hours[h] += s.total_ugx;
    hourOrders[h] += 1;
    weekdays[wd] += s.total_ugx;
    weekdayOrders[wd] += 1;
    if (s.is_credit) creditRevenue += s.total_ugx;
    else paidRevenue += s.total_ugx;
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
    hours: hourSlice.length ? hourSlice : hours.map((rev, h) => ({ h, rev, orders: hourOrders[h] })).slice(8, 23),
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

export function renderSalesPatterns(container, sales, range) {
  if (!container) return;
  const rangeSales = range.days ? filterSalesByRange(sales, range) : sales;
  const p = computeSalesPatterns(rangeSales);

  if (!rangeSales.length) {
    container.innerHTML = showPlaceholder('sales', sales.length)
      ? salesPatternsPlaceholder()
      : `<div class="receipt-empty">No sales in this period yet</div>`;
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
          <span class="pattern-hint">${p.creditPct}% on credit</span>
        </div>
        <div class="mix-bar">
          <div class="mix-paid" style="width:${100 - p.creditPct}%"></div>
          <div class="mix-credit" style="width:${p.creditPct}%"></div>
        </div>
        <div class="mix-legend">
          <span><i class="mix-dot paid"></i>Paid ${fmtCompact(p.paidRevenue)}</span>
          <span><i class="mix-dot credit"></i>Credit ${fmtCompact(p.creditRevenue)}</span>
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
