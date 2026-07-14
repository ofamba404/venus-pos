import { wireHeaderBodyAccordions } from './animations.js';
import { mondayOfWeek } from './analytics-chart.js';
import { clients, salesCache } from './state.js';
import { escapeHtml, fmtCompact, fmtUGX, isSameDay, isToday } from './utils.js';
import { receiptListPlaceholder, showPlaceholder } from './pending.js';

/** Completed Mon–Sun weeks kept as week rows before rolling into calendar months. */
const RECENT_COMPLETED_WEEKS = 4;

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfWeekSunday(monday) {
  const end = new Date(monday);
  end.setDate(monday.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function weekKey(monday) {
  return dayKey(monday);
}

function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function isYesterday(d) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return isSameDay(d, y);
}

function formatDayLabel(dateObj) {
  if (isToday(dateObj)) return 'Today';
  if (isYesterday(dateObj)) return 'Yesterday';
  return dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatWeekLabel(monday) {
  const sunday = endOfWeekSunday(monday);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const start = monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const end = sunday.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${start} – ${end}`;
}

function formatMonthLabel(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function groupSalesByDay(sales) {
  const dayMap = new Map();
  sales.forEach((s) => {
    const dateObj = startOfLocalDay(new Date(s.created_at));
    const key = dayKey(dateObj);
    if (!dayMap.has(key)) dayMap.set(key, { dateObj, sales: [] });
    dayMap.get(key).sales.push(s);
  });
  for (const group of dayMap.values()) {
    group.sales.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    group.total = group.sales.reduce((sum, s) => sum + (s.total_ugx || 0), 0);
    group.count = group.sales.length;
  }
  return dayMap;
}

/**
 * Hierarchy:
 * - Current Mon–Sun week → day accordions (Today expanded)
 * - Up to 4 most recent completed weeks → week accordions → days
 * - Older history → calendar months → weeks (split at month edges) → days
 *
 * Calendar months absorb leftover days past 28 naturally; weeks that straddle
 * two months are split so each day lives in its real month.
 */
export function buildOrderHistoryTree(sales, now = new Date()) {
  const dayMap = groupSalesByDay(sales);
  const today = startOfLocalDay(now);
  const thisWeekStart = mondayOfWeek(today);

  const thisWeekDays = [];
  const completedWeekMap = new Map();

  for (const group of dayMap.values()) {
    if (group.dateObj >= thisWeekStart) {
      thisWeekDays.push(group);
    } else {
      const monday = mondayOfWeek(group.dateObj);
      const key = weekKey(monday);
      if (!completedWeekMap.has(key)) {
        completedWeekMap.set(key, { monday, days: [] });
      }
      completedWeekMap.get(key).days.push(group);
    }
  }

  thisWeekDays.sort((a, b) => b.dateObj - a.dateObj);

  const completedWeeks = Array.from(completedWeekMap.values())
    .map((w) => {
      w.days.sort((a, b) => b.dateObj - a.dateObj);
      w.total = w.days.reduce((sum, d) => sum + d.total, 0);
      w.count = w.days.reduce((sum, d) => sum + d.count, 0);
      return w;
    })
    .sort((a, b) => b.monday - a.monday);

  const recentWeeks = completedWeeks.slice(0, RECENT_COMPLETED_WEEKS);
  const olderWeeks = completedWeeks.slice(RECENT_COMPLETED_WEEKS);

  const monthMap = new Map();
  for (const week of olderWeeks) {
    for (const day of week.days) {
      const key = monthKey(day.dateObj);
      if (!monthMap.has(key)) {
        monthMap.set(key, {
          year: day.dateObj.getFullYear(),
          month: day.dateObj.getMonth(),
          days: [],
        });
      }
      monthMap.get(key).days.push(day);
    }
  }

  const months = Array.from(monthMap.values())
    .map((m) => {
      m.days.sort((a, b) => b.dateObj - a.dateObj);
      // Rebuild week slices from days that actually fall in this month
      // (handles month-boundary leftovers without fake 28-day months).
      const weekBuckets = new Map();
      for (const day of m.days) {
        const monday = mondayOfWeek(day.dateObj);
        const key = weekKey(monday);
        if (!weekBuckets.has(key)) weekBuckets.set(key, { monday, days: [] });
        weekBuckets.get(key).days.push(day);
      }
      m.weeks = Array.from(weekBuckets.values())
        .map((w) => {
          w.days.sort((a, b) => b.dateObj - a.dateObj);
          w.total = w.days.reduce((sum, d) => sum + d.total, 0);
          w.count = w.days.reduce((sum, d) => sum + d.count, 0);
          // Label by the days present in this month, not the full Mon–Sun span
          const newest = w.days[0].dateObj;
          const oldest = w.days[w.days.length - 1].dateObj;
          if (isSameDay(newest, oldest)) {
            w.label = newest.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          } else {
            const sameMonth = newest.getMonth() === oldest.getMonth();
            const end = newest.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
            const start = oldest.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            w.label = `${start} – ${end}`;
          }
          return w;
        })
        .sort((a, b) => b.monday - a.monday);
      m.total = m.days.reduce((sum, d) => sum + d.total, 0);
      m.count = m.days.reduce((sum, d) => sum + d.count, 0);
      m.label = formatMonthLabel(m.year, m.month);
      return m;
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);

  return { thisWeekDays, recentWeeks, months };
}

function renderOrderRow(s) {
  const t = new Date(s.created_at);
  const time = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const itemLines = (s.items || [])
    .map((i) => `${escapeHtml(i.product_name)}${i.detail ? ` — ${escapeHtml(i.detail)}` : ''}`)
    .join('<br>');
  const client = s.client_id ? clients.find((c) => c.id === s.client_id) : null;
  const clientLine = client ? `<div class="r-client">${escapeHtml(client.name)}</div>` : '';
  return `<button class="receipt-order" type="button" data-edit-sale="${s.id}">
    <div class="r-head"><span class="r-time">${time}</span><span class="r-amt">${fmtUGX(s.total_ugx)}${s.is_credit && !s.credit_cleared ? '<span class="credit-tag">credit</span>' : ''}</span></div>
    ${clientLine}
    <div class="r-items">${itemLines}</div>
  </button>`;
}

function renderDayGroup(group, { expanded = false, id } = {}) {
  const dayLabel = formatDayLabel(group.dateObj);
  const rows = group.sales.map(renderOrderRow).join('');
  return `
    <div class="order-day-group">
      <button class="order-day-header${expanded ? ' expanded' : ''}" type="button" data-oh-day="${id}" aria-expanded="${expanded}">
        <span class="day-label">${dayLabel} <span class="day-meta">(${group.count})</span></span>
        <span class="order-header-right">
          <span class="day-meta">${fmtCompact(group.total)}</span>
          <span class="day-caret" aria-hidden="true">▸</span>
        </span>
      </button>
      <div class="order-day-body" data-oh-day-body="${id}">
        ${rows}
      </div>
    </div>`;
}

function renderWeekGroup(week, { id, useCustomLabel = false } = {}) {
  const label = useCustomLabel ? week.label : formatWeekLabel(week.monday);
  const days = week.days.map((d, i) => renderDayGroup(d, { expanded: false, id: `${id}-d${i}` })).join('');
  return `
    <div class="order-week-group">
      <button class="order-week-header" type="button" data-oh-week="${id}" aria-expanded="false">
        <span class="order-period-label">
          <span class="order-period-kind">Week</span>
          ${escapeHtml(label)}
          <span class="day-meta">(${week.count})</span>
        </span>
        <span class="order-header-right">
          <span class="day-meta">${fmtCompact(week.total)}</span>
          <span class="day-caret" aria-hidden="true">▸</span>
        </span>
      </button>
      <div class="order-week-body" data-oh-week-body="${id}">
        ${days}
      </div>
    </div>`;
}

function renderMonthGroup(month, { id } = {}) {
  const weeks = month.weeks.map((w, i) => renderWeekGroup(w, { id: `${id}-w${i}`, useCustomLabel: true })).join('');
  return `
    <div class="order-month-group">
      <button class="order-month-header" type="button" data-oh-month="${id}" aria-expanded="false">
        <span class="order-period-label">
          <span class="order-period-kind">Month</span>
          ${escapeHtml(month.label)}
          <span class="day-meta">(${month.count})</span>
        </span>
        <span class="order-header-right">
          <span class="day-meta">${fmtCompact(month.total)}</span>
          <span class="day-caret" aria-hidden="true">▸</span>
        </span>
      </button>
      <div class="order-month-body" data-oh-month-body="${id}">
        ${weeks}
      </div>
    </div>`;
}

function renderHistoryHero(sales) {
  const todaySales = sales.filter((s) => isToday(s.created_at));
  const todayTotal = todaySales.reduce((sum, s) => sum + (s.total_ugx || 0), 0);
  const allTotal = sales.reduce((sum, s) => sum + (s.total_ugx || 0), 0);

  const hero = document.getElementById('orderHistoryHero');
  if (!hero) return;

  hero.innerHTML = `
    <div class="history-hero-copy">
      <h2 class="history-title">Order history</h2>
      <p class="history-sub">Browse by day, then week, then month as sales pile up.</p>
    </div>
    <div class="history-hero-stats" role="group" aria-label="Order totals">
      <div class="history-stat">
        <div class="history-stat-val">${todaySales.length}</div>
        <div class="history-stat-lbl">Today</div>
        <div class="history-stat-sub">${todaySales.length ? fmtCompact(todayTotal) : '—'}</div>
      </div>
      <div class="history-stat">
        <div class="history-stat-val">${sales.length}</div>
        <div class="history-stat-lbl">Loaded</div>
        <div class="history-stat-sub">${sales.length ? fmtCompact(allTotal) : '—'}</div>
      </div>
    </div>`;
}

export function renderOrderHistory() {
  const list = document.getElementById('orderHistoryList');
  if (!list) return;

  renderHistoryHero(salesCache);

  if (salesCache.length === 0) {
    list.innerHTML = showPlaceholder('sales')
      ? receiptListPlaceholder()
      : `<div class="receipt-empty">No orders yet — ring one up on the Home tab</div>`;
    return;
  }

  const { thisWeekDays, recentWeeks, months } = buildOrderHistoryTree(salesCache);

  const sections = [];

  if (thisWeekDays.length) {
    const dayHtml = thisWeekDays
      .map((d, i) => renderDayGroup(d, { expanded: isToday(d.dateObj), id: `tw${i}` }))
      .join('');
    sections.push(`
      <section class="history-section">
        <div class="history-section-label">This week</div>
        <div class="receipt-edge top"></div>
        <div class="receipt history-receipt">${dayHtml}</div>
        <div class="receipt-edge bottom"></div>
      </section>`);
  }

  if (recentWeeks.length) {
    const weekHtml = recentWeeks.map((w, i) => renderWeekGroup(w, { id: `rw${i}` })).join('');
    sections.push(`
      <section class="history-section">
        <div class="history-section-label">Earlier weeks</div>
        <div class="receipt-edge top"></div>
        <div class="receipt history-receipt">${weekHtml}</div>
        <div class="receipt-edge bottom"></div>
      </section>`);
  }

  if (months.length) {
    const monthHtml = months.map((m, i) => renderMonthGroup(m, { id: `m${i}` })).join('');
    sections.push(`
      <section class="history-section">
        <div class="history-section-label">Earlier months</div>
        <div class="receipt-edge top"></div>
        <div class="receipt history-receipt">${monthHtml}</div>
        <div class="receipt-edge bottom"></div>
      </section>`);
  }

  list.innerHTML = sections.join('') || `<div class="receipt-empty">No orders yet — ring one up on the Home tab</div>`;

  wireHeaderBodyAccordions(list, { headerSelector: '.order-month-header' });
  wireHeaderBodyAccordions(list, { headerSelector: '.order-week-header' });
  wireHeaderBodyAccordions(list, { headerSelector: '.order-day-header' });

  list.querySelectorAll('[data-edit-sale]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { openEditSale } = await import('./analytics.js');
      openEditSale(btn.dataset.editSale);
    });
  });
}
