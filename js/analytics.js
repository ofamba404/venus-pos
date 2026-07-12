import { clearCache } from './cache.js';
import { sbFetch } from './api.js';
import { CATEGORIES, LOW_STOCK_THRESHOLD } from './config.js';
import { applyActiveHighlight, getActiveStatusHighlight } from './inventory.js';
import { loadSalesToday } from './sales.js';
import { clients, inventory, salesCache } from './state.js';
import { escapeHtml, fmtCompact, fmtUGX, isSameDay, isToday, showConfirm, showToast } from './utils.js';

export function renderAnalytics() {
  const todaySales = salesCache.filter((s) => isToday(s.created_at));
  const revenueToday = todaySales.reduce((sum, s) => sum + s.total_ugx, 0);
  const revenueAll = salesCache.reduce((sum, s) => sum + s.total_ugx, 0);
  const ordersCount = salesCache.length;
  const avgOrder = ordersCount > 0 ? revenueAll / ordersCount : 0;

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);
  const revenueWeek = salesCache.filter((s) => new Date(s.created_at) >= weekAgo).reduce((sum, s) => sum + s.total_ugx, 0);
  const revenueMonth = salesCache
    .filter((s) => {
      const d = new Date(s.created_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((sum, s) => sum + s.total_ugx, 0);

  const productTotals = {};
  salesCache.forEach((s) =>
    (s.items || []).forEach((i) => {
      productTotals[i.product_name] = (productTotals[i.product_name] || 0) + 1;
    }),
  );
  let topProduct = '—';
  let topCount = 0;
  Object.entries(productTotals).forEach(([name, count]) => {
    if (count > topCount) {
      topCount = count;
      topProduct = name;
    }
  });

  const outstandingCredit = salesCache.filter((s) => s.is_credit && !s.credit_cleared);
  const totalCreditOwed = outstandingCredit.reduce((sum, s) => sum + s.total_ugx, 0);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="val">${fmtUGX(revenueToday)}</div><div class="lbl">Today</div></div>
    <div class="stat-card"><div class="val">${fmtUGX(revenueWeek)}</div><div class="lbl">Last 7 days</div></div>
    <div class="stat-card"><div class="val">${fmtUGX(revenueMonth)}</div><div class="lbl">This month</div></div>
    <div class="stat-card credit ${totalCreditOwed > 0 ? 'has-credit' : 'no-credit'}"><div class="val">${fmtUGX(totalCreditOwed)}</div><div class="lbl">Total credit owed</div></div>
    <div class="stat-card"><div class="val">${fmtUGX(revenueAll)}</div><div class="lbl">All-time revenue</div></div>
    <div class="stat-card"><div class="val">${ordersCount}</div><div class="lbl">Total orders</div></div>
    <div class="stat-card"><div class="val">${fmtUGX(avgOrder)}</div><div class="lbl">Avg. order value</div></div>
    <div class="stat-card"><div class="val stat-card-product">${escapeHtml(topProduct)}</div><div class="lbl">Most ordered</div></div>
  `;

  const creditListEl = document.getElementById('creditList');
  if (outstandingCredit.length === 0) {
    creditListEl.innerHTML = `<div class="receipt-empty">No outstanding credit — everyone's settled up</div>`;
  } else {
    creditListEl.innerHTML = outstandingCredit
      .map((s) => {
        const client = s.client_id ? clients.find((c) => c.id === s.client_id) : null;
        const t = new Date(s.created_at);
        const dateStr = t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `
          <div class="credit-row">
            <div>
              <div class="cr-name">${escapeHtml(client ? client.name : 'Unknown client')}</div>
              <div class="cr-meta">since ${dateStr}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <div class="cr-amt">${fmtUGX(s.total_ugx)}</div>
              <button class="credit-clear-btn" data-clear-credit="${s.id}" type="button">Mark cleared</button>
            </div>
          </div>`;
      })
      .join('');
    creditListEl.querySelectorAll('[data-clear-credit]').forEach((btn) => {
      btn.addEventListener('click', () => clearCredit(btn.dataset.clearCredit));
    });
  }

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const rev = salesCache.filter((s) => isSameDay(new Date(s.created_at), d)).reduce((sum, s) => sum + s.total_ugx, 0);
    days.push({ label: d.toLocaleDateString(undefined, { weekday: 'short' }), revenue: rev, dayIndex: d.getDay() });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.revenue));
  document.getElementById('revenueTrend').innerHTML = days
    .map(
      (d) => `
      <div class="bar-row" data-day-index="${d.dayIndex}">
        <div class="bar-label">${d.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((d.revenue / maxDay) * 100)}%; background:var(--jade);"></div></div>
        <div class="bar-value">${fmtCompact(d.revenue)}</div>
      </div>`,
    )
    .join('');

  const maxStock = Math.max(1, ...CATEGORIES.map((c) => inventory[c.id]));
  document.getElementById('stockBars').innerHTML = CATEGORIES.map((c) => {
    const stock = inventory[c.id];
    const status = stock === 0 ? 'out' : stock < LOW_STOCK_THRESHOLD ? 'low' : 'ok';
    const pct = Math.round((stock / maxStock) * 100);
    const label = c.sub ? `${c.name} ${c.sub}` : c.name;
    return `<div class="bar-row" data-status="${status}">
      <div class="bar-label">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${c.color};"></div></div>
      <div class="bar-value" style="${status !== 'ok' ? `color:var(--${status === 'low' ? 'gold' : 'danger'});` : ''}">${stock}</div>
    </div>`;
  }).join('');
  applyActiveHighlight();

  const productRevenueMap = {};
  salesCache.forEach((s) =>
    (s.items || []).forEach((i) => {
      productRevenueMap[i.product_name] = (productRevenueMap[i.product_name] || 0) + i.line_total;
    }),
  );
  const sortedProducts = Object.entries(productRevenueMap).sort((a, b) => b[1] - a[1]);
  const maxProdRev = Math.max(1, ...sortedProducts.map(([, v]) => v));
  document.getElementById('productRevenue').innerHTML =
    sortedProducts.length === 0
      ? `<div class="receipt-empty">No sales yet</div>`
      : sortedProducts
          .map(
            ([name, rev]) => `
        <div class="bar-row">
          <div class="bar-label wide">${escapeHtml(name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round((rev / maxProdRev) * 100)}%; background:var(--jade);"></div></div>
          <div class="bar-value">${fmtCompact(rev)}</div>
        </div>`,
          )
          .join('');

  const clientTotals = {};
  salesCache.forEach((s) => {
    if (!s.client_id) return;
    if (!clientTotals[s.client_id]) clientTotals[s.client_id] = { revenue: 0, orders: 0 };
    clientTotals[s.client_id].revenue += s.total_ugx;
    clientTotals[s.client_id].orders += 1;
  });
  const rankedClients = Object.entries(clientTotals)
    .map(([id, data]) => ({ name: clients.find((c) => c.id === id)?.name || 'Unknown', ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  document.getElementById('topClients').innerHTML =
    rankedClients.length === 0
      ? `<div class="receipt-empty">No client-attributed sales yet</div>`
      : rankedClients
          .map(
            (c, i) => `
        <div class="fixed-item">
          <span>${i + 1}. ${escapeHtml(c.name)}</span>
          <span style="font-family:'DM Mono',monospace; color:var(--gold); font-size:12px;">${fmtUGX(c.revenue)} · ${c.orders} order${c.orders > 1 ? 's' : ''}</span>
        </div>`,
          )
          .join('');

  const list = document.getElementById('receiptList');
  if (salesCache.length === 0) {
    list.innerHTML = `<div class="receipt-empty">No orders yet — ring one up on the Home tab</div>`;
  } else {
    const dayMap = new Map();
    salesCache.forEach((s) => {
      const key = new Date(s.created_at).toDateString();
      if (!dayMap.has(key)) dayMap.set(key, { dateObj: new Date(s.created_at), sales: [] });
      dayMap.get(key).sales.push(s);
    });
    const dayGroups = Array.from(dayMap.values()).sort((a, b) => b.dateObj - a.dateObj);

    list.innerHTML = dayGroups
      .map((group, idx) => {
        const isTodayGroup = isToday(group.dateObj);
        const dayLabel = isTodayGroup
          ? 'Today'
          : group.dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const dayTotal = group.sales.reduce((sum, s) => sum + s.total_ugx, 0);

        const rows = group.sales
          .map((s) => {
            const t = new Date(s.created_at);
            const time = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            const itemLines = (s.items || [])
              .map((i) => `${escapeHtml(i.product_name)}${i.detail ? ` — ${escapeHtml(i.detail)}` : ''}`)
              .join('<br>');
            const client = s.client_id ? clients.find((c) => c.id === s.client_id) : null;
            const clientLine = client ? `<div class="r-client">${escapeHtml(client.name)}</div>` : '';
            return `<div class="receipt-order">
            <div class="r-head"><span class="r-time">${time}</span><span class="r-amt">${fmtUGX(s.total_ugx)}${s.is_credit && !s.credit_cleared ? '<span class="credit-tag">credit</span>' : ''}</span></div>
            ${clientLine}
            <div class="r-items">${itemLines}</div>
          </div>`;
          })
          .join('');

        return `
          <div class="order-day-group">
            <button class="order-day-header ${isTodayGroup ? 'expanded' : ''}" data-day-toggle="${idx}" type="button">
              <span class="day-label">${dayLabel} <span class="day-meta">(${group.sales.length})</span></span>
              <span style="display:flex; align-items:center; gap:8px;">
                <span class="day-meta">${fmtCompact(dayTotal)}</span>
                <span class="day-caret">▸</span>
              </span>
            </button>
            <div class="order-day-body" data-day-body="${idx}" ${isTodayGroup ? '' : 'hidden'}>
              ${rows}
            </div>
          </div>`;
      })
      .join('');

    list.querySelectorAll('[data-day-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.dayToggle;
        const body = list.querySelector(`[data-day-body="${idx}"]`);
        if (body.hasAttribute('hidden')) {
          body.removeAttribute('hidden');
          btn.classList.add('expanded');
        } else {
          body.setAttribute('hidden', '');
          btn.classList.remove('expanded');
        }
      });
    });
  }
}

async function clearCredit(saleId) {
  const ok = await showConfirm('Mark this credit as cleared?');
  if (!ok) return;
  try {
    const res = await sbFetch(`sales?id=eq.${saleId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ credit_cleared: true, cleared_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    clearCache('sales');
    showToast('Credit cleared');
    await loadSalesToday();
    renderAnalytics();
  } catch (e) {
    console.error('clear credit failed', e);
    showToast('Could not clear credit', true);
  }
}

export function wireAnalyticsPage() {
  if (location.hash === '#stock' && getActiveStatusHighlight()) {
    setTimeout(() => {
      document.getElementById('stockLevelsLabel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      applyActiveHighlight();
    }, 100);
  }
  if (location.hash === '#orders') {
    setTimeout(() => {
      document.getElementById('analyticsBottom')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}
