import { clearCache, writeCache } from './cache.js';
import { sbFetch } from './api.js';
import { CATEGORIES, LOW_STOCK_THRESHOLD } from './config.js';
import { applyActiveHighlight, getActiveStatusHighlight } from './inventory.js';
import { animateCartSheetContent, applyBarFillWidths, isSheetModalOpen, setAccordionPanelInstant, wireHeaderBodyAccordions } from './animations.js';
import {
  filterSalesByRange,
  getChartRange,
  renderRevenueChart,
  renderSalesPatterns,
} from './analytics-chart.js';
import { loadSalesToday } from './sales.js';
import { resolveClientId } from './clients.js';
import { clientAutocompleteMarkup, wireClientAutocomplete } from './client-autocomplete.js';
import { clients, inventory, isPageDataSettled, salesCache } from './state.js';
import {
  closeEditModal,
  escapeHtml,
  fmtCompact,
  fmtUGX,
  isSameDay,
  isToday,
  openEditModal,
  showConfirm,
  showToast,
  skeletonChart,
  skeletonLines,
  skeletonRows,
  skeletonStatCards,
} from './utils.js';

let editingSaleId = null;
let editSaleItems = [];
let editSaleClientId = '';
let editSaleClientName = '';
let editSaleIsCredit = false;
let editSaleCreditCleared = false;
let creditPanelOpen = false;

function renderCreditPanel(outstandingCredit, totalCreditOwed) {
  const uniqueClients = new Set(
    outstandingCredit.map((s) => s.client_id || `unknown-${s.id}`),
  ).size;

  if (outstandingCredit.length === 0) {
    return `
      <div class="credit-panel settled">
        <div class="credit-panel-head">
          <div class="credit-panel-icon ok" aria-hidden="true">✓</div>
          <div class="credit-panel-copy">
            <div class="credit-panel-title">All settled</div>
            <div class="credit-panel-sub">No outstanding credit right now</div>
          </div>
        </div>
      </div>`;
  }

  const previewNames = outstandingCredit
    .map((s) => {
      const client = s.client_id ? clients.find((c) => c.id === s.client_id) : null;
      return client ? client.name : 'Unknown';
    })
    .filter((name, i, arr) => arr.indexOf(name) === i)
    .slice(0, 3);

  const preview =
    previewNames.length > 0
      ? `<div class="credit-panel-chips">${previewNames
          .map((name) => `<span class="credit-chip">${escapeHtml(name)}</span>`)
          .join('')}${uniqueClients > 3 ? `<span class="credit-chip more">+${uniqueClients - 3}</span>` : ''}</div>`
      : '';

  const rows = outstandingCredit
    .map((s) => {
      const client = s.client_id ? clients.find((c) => c.id === s.client_id) : null;
      const t = new Date(s.created_at);
      const dateStr = t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const initials = (client?.name || '?')
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
      return `
        <div class="credit-panel-item">
          <div class="credit-panel-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="credit-panel-item-main">
            <div class="cr-name">${escapeHtml(client ? client.name : 'Unknown client')}</div>
            <div class="cr-meta">${fmtUGX(s.total_ugx)} · since ${dateStr}</div>
          </div>
          <button class="credit-clear-btn" data-clear-credit="${s.id}" type="button">Clear</button>
        </div>`;
    })
    .join('');

  const expanded = creditPanelOpen ? ' expanded' : '';

  return `
    <div class="credit-panel owes${expanded}" id="creditPanel">
      <button class="credit-panel-toggle" type="button" aria-expanded="${creditPanelOpen}" aria-controls="creditPanelBody">
        <div class="credit-panel-icon" aria-hidden="true">!</div>
        <div class="credit-panel-copy">
          <div class="credit-panel-title">${fmtUGX(totalCreditOwed)} owed</div>
          <div class="credit-panel-sub">${uniqueClients} client${uniqueClients === 1 ? '' : 's'} · ${outstandingCredit.length} order${outstandingCredit.length === 1 ? '' : 's'}</div>
          ${preview}
        </div>
        <span class="credit-panel-caret" aria-hidden="true">▸</span>
      </button>
      <div class="credit-panel-body" id="creditPanelBody">
        ${rows}
      </div>
    </div>`;
}

function wireCreditPanel() {
  const panel = document.getElementById('creditPanel');
  if (!panel) return;

  const body = panel.querySelector('#creditPanelBody');
  const btn = panel.querySelector('.credit-panel-toggle');
  if (body) setAccordionPanelInstant(body, creditPanelOpen);

  panel.querySelector('.credit-panel-toggle')?.addEventListener('click', () => {
    creditPanelOpen = !creditPanelOpen;
    panel.classList.toggle('expanded', creditPanelOpen);
    btn?.setAttribute('aria-expanded', String(creditPanelOpen));
    if (body) animateAccordionPanel(body, creditPanelOpen);
  });

  panel.querySelectorAll('[data-clear-credit]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearCredit(btn.dataset.clearCredit);
    });
  });
}

function revenueDelta(today, yesterday) {
  if (yesterday === 0 && today === 0) return { text: 'Same as yesterday', cls: 'neutral' };
  if (yesterday === 0) return { text: 'First sales today', cls: 'up' };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return { text: 'Same as yesterday', cls: 'neutral' };
  if (pct > 0) return { text: `+${pct}% vs yesterday`, cls: 'up' };
  return { text: `${pct}% vs yesterday`, cls: 'down' };
}

function renderOverviewSections() {
  if (!isPageDataSettled() && salesCache.length === 0) {
    document.getElementById('statCards').innerHTML = skeletonStatCards();
    return;
  }

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
  if (outstandingCredit.length === 0) creditPanelOpen = false;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayRev = salesCache
    .filter((s) => isSameDay(new Date(s.created_at), yesterday))
    .reduce((sum, s) => sum + s.total_ugx, 0);
  const delta = revenueDelta(revenueToday, yesterdayRev);
  const monthShare = revenueAll > 0 ? Math.round((revenueMonth / revenueAll) * 100) : 0;
  const ordersToday = todaySales.length;

  document.getElementById('statCards').innerHTML = `
    <div class="ao-hero">
      <div class="ao-hero-head">
        <span class="ao-eyebrow">Today</span>
        <span class="ao-delta ${delta.cls}">${delta.text}</span>
      </div>
      <div class="ao-hero-value">${fmtUGX(revenueToday)}</div>
      <div class="ao-hero-sub">${ordersToday} order${ordersToday === 1 ? '' : 's'} today · ${fmtCompact(revenueWeek)} this week</div>
    </div>

    <div class="ao-tiles">
      <div class="ao-tile">
        <div class="ao-tile-top">
          <span class="ao-tile-label">This month</span>
          <span class="ao-tile-pill">${monthShare}% of all-time</span>
        </div>
        <div class="ao-tile-value">${fmtCompact(revenueMonth)}</div>
        <div class="ao-tile-track"><div class="ao-tile-fill" style="width:${monthShare}%"></div></div>
      </div>
      <div class="ao-tile">
        <div class="ao-tile-top">
          <span class="ao-tile-label">All orders</span>
          <span class="ao-tile-pill">${fmtCompact(avgOrder)} avg</span>
        </div>
        <div class="ao-tile-value">${ordersCount}</div>
        <div class="ao-tile-foot">Lifetime revenue <strong>${fmtCompact(revenueAll)}</strong></div>
      </div>
    </div>

    <div class="ao-feature">
      <div class="ao-feature-badge" aria-hidden="true">★</div>
      <div class="ao-feature-body">
        <div class="ao-feature-kicker">Customer favorite</div>
        <div class="ao-feature-title">${escapeHtml(topProduct)}</div>
        <div class="ao-feature-sub">${topCount > 0 ? `${topCount} unit${topCount === 1 ? '' : 's'} ordered` : 'No orders yet'}</div>
      </div>
    </div>

    ${renderCreditPanel(outstandingCredit, totalCreditOwed)}
  `;

  applyBarFillWidths(document.getElementById('statCards'));
  wireCreditPanel();
}

function renderRangeSections() {
  const range = getChartRange();
  const rangeSales = filterSalesByRange(salesCache, range);

  renderRevenueChart(document.getElementById('revenueChart'), salesCache, range, () => renderRangeSections());
  renderSalesPatterns(document.getElementById('salesPatterns'), salesCache, range);

  const rangeLabel = document.getElementById('productRevenueLabel');
  if (rangeLabel) {
    rangeLabel.textContent = range.id === 'all' ? 'Revenue by product — all time' : `Revenue by product — ${range.label}`;
  }

  const productRevenueMap = {};
  rangeSales.forEach((s) =>
    (s.items || []).forEach((i) => {
      productRevenueMap[i.product_name] = (productRevenueMap[i.product_name] || 0) + i.line_total;
    }),
  );
  const sortedProducts = Object.entries(productRevenueMap).sort((a, b) => b[1] - a[1]);
  const maxProdRev = Math.max(1, ...sortedProducts.map(([, v]) => v));
  const productRevenueEl = document.getElementById('productRevenue');
  if (productRevenueEl) {
    productRevenueEl.innerHTML =
      sortedProducts.length === 0
        ? !isPageDataSettled()
          ? skeletonLines(4)
          : `<div class="receipt-empty">No sales in this period</div>`
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
  }

  applyBarFillWidths(productRevenueEl);

  const clientTotals = {};
  rangeSales.forEach((s) => {
    if (!s.client_id) return;
    if (!clientTotals[s.client_id]) clientTotals[s.client_id] = { revenue: 0, orders: 0 };
    clientTotals[s.client_id].revenue += s.total_ugx;
    clientTotals[s.client_id].orders += 1;
  });
  const rankedClients = Object.entries(clientTotals)
    .map(([id, data]) => ({ name: clients.find((c) => c.id === id)?.name || 'Unknown', ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  const topClientsEl = document.getElementById('topClients');
  if (topClientsEl) {
    topClientsEl.innerHTML =
      rankedClients.length === 0
        ? !isPageDataSettled()
          ? skeletonRows(3)
          : `<div class="receipt-empty">No client-attributed sales in this period</div>`
        : rankedClients
          .map(
            (c, i) => `
        <div class="fixed-item">
          <span>${i + 1}. ${escapeHtml(c.name)}</span>
          <span style="color:var(--gold); font-size:12px;">${fmtUGX(c.revenue)} · ${c.orders} order${c.orders > 1 ? 's' : ''}</span>
        </div>`,
          )
          .join('');
  }
}

export function renderAnalytics() {
  renderOverviewSections();
  renderRangeSections();

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
  applyBarFillWidths(document.getElementById('stockBars'));

  const list = document.getElementById('receiptList');
  if (salesCache.length === 0) {
    list.innerHTML = !isPageDataSettled()
      ? skeletonRows(4)
      : `<div class="receipt-empty">No orders yet — ring one up on the Home tab</div>`;
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
            return `<button class="receipt-order" type="button" data-edit-sale="${s.id}">
            <div class="r-head"><span class="r-time">${time}</span><span class="r-amt">${fmtUGX(s.total_ugx)}${s.is_credit && !s.credit_cleared ? '<span class="credit-tag">credit</span>' : ''}</span></div>
            ${clientLine}
            <div class="r-items">${itemLines}</div>
          </button>`;
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
            <div class="order-day-body" data-day-body="${idx}">
              ${rows}
            </div>
          </div>`;
      })
      .join('');

    wireHeaderBodyAccordions(list, { headerSelector: '.order-day-header' });

    list.querySelectorAll('[data-edit-sale]').forEach((btn) => {
      btn.addEventListener('click', () => openEditSale(btn.dataset.editSale));
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

function mergeItemBreakdown(items) {
  const merged = {};
  items.forEach((item) => {
    Object.entries(item.breakdown || {}).forEach(([id, qty]) => {
      merged[id] = (merged[id] || 0) + qty;
    });
  });
  return merged;
}

function saleItemsTotal(items) {
  return items.reduce((sum, i) => sum + (i.line_total || 0), 0);
}

function openEditSale(saleId) {
  const sale = salesCache.find((s) => s.id === saleId);
  if (!sale) return;

  editingSaleId = saleId;
  editSaleItems = (sale.items || []).map((i) => ({ ...i, breakdown: { ...(i.breakdown || {}) } }));
  editSaleClientId = sale.client_id || '';
  editSaleClientName = sale.client_id ? clients.find((c) => c.id === sale.client_id)?.name || '' : '';
  editSaleIsCredit = !!sale.is_credit;
  editSaleCreditCleared = !!sale.credit_cleared;

  renderEditSaleModal();
  openEditModal();
}

function renderEditSaleModal() {
  const body = document.getElementById('editModalBody');
  if (!body) return;

  const sale = salesCache.find((s) => s.id === editingSaleId);
  const time = sale ? new Date(sale.created_at).toLocaleString() : '';
  const total = saleItemsTotal(editSaleItems);

  const itemRows =
    editSaleItems.length === 0
      ? `<div class="cart-empty">No items — remove this order or add items from Home</div>`
      : editSaleItems
          .map(
            (item, idx) => `
        <div class="cart-item">
          <div>
            <div class="ci-name">${escapeHtml(item.product_name)}</div>
            <div class="ci-detail">${escapeHtml(item.detail || '')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="ci-price">${fmtUGX(item.line_total)}</div>
            <button class="cart-remove" data-remove-sale-item="${idx}" type="button">✕</button>
          </div>
        </div>`,
          )
          .join('');

  body.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="editModalTitle">Edit order</div>
      <button class="modal-close" id="editSaleClose" type="button">✕</button>
    </div>
    <div class="modal-progress">${escapeHtml(time)}</div>
    <div class="client-picker">
      <label>Client</label>
      ${clientAutocompleteMarkup({
        inputId: 'editSaleClient',
        dropdownId: 'editSaleClientDropdown',
        clearId: 'editSaleClientClear',
        value: editSaleClientName,
        placeholder: 'Client name (optional)',
      })}
    </div>
    <label class="credit-toggle-row">
      <input type="checkbox" id="editSaleCredit" ${editSaleIsCredit ? 'checked' : ''} />
      <span>Recorded as credit</span>
    </label>
    ${editSaleIsCredit ? `<label class="credit-toggle-row"><input type="checkbox" id="editSaleCreditCleared" ${editSaleCreditCleared ? 'checked' : ''} /><span>Credit cleared (paid)</span></label>` : ''}
    ${itemRows}
    <div class="cart-total-row">
      <div class="ct-label">Total</div>
      <div class="ct-val">${fmtUGX(total)}</div>
    </div>
    <div class="modal-btns">
      <button class="modal-btn cancel" id="editSaleVoid" type="button">Void order</button>
      <button class="modal-btn cancel" id="editSaleCancel" type="button">Cancel</button>
      <button class="modal-btn confirm" id="editSaleSave" type="button" ${editSaleItems.length ? '' : 'disabled'}>Save</button>
    </div>`;

  const editOverlay = document.getElementById('editOverlay');
  if (isSheetModalOpen(editOverlay)) animateCartSheetContent(body);

  document.getElementById('editSaleClose')?.addEventListener('click', closeEditModal);
  document.getElementById('editSaleCancel')?.addEventListener('click', closeEditModal);
  wireClientAutocomplete({
    inputId: 'editSaleClient',
    dropdownId: 'editSaleClientDropdown',
    clearId: 'editSaleClientClear',
    onChange: (name, client) => {
      editSaleClientName = name;
      editSaleClientId = client?.id || '';
    },
  });
  document.getElementById('editSaleCredit')?.addEventListener('change', (e) => {
    editSaleIsCredit = e.target.checked;
    if (!editSaleIsCredit) editSaleCreditCleared = true;
    renderEditSaleModal();
  });
  document.getElementById('editSaleCreditCleared')?.addEventListener('change', (e) => {
    editSaleCreditCleared = e.target.checked;
  });
  body.querySelectorAll('[data-remove-sale-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.removeSaleItem, 10);
      if (idx >= 0 && idx < editSaleItems.length) {
        editSaleItems.splice(idx, 1);
        renderEditSaleModal();
      }
    });
  });
  document.getElementById('editSaleSave')?.addEventListener('click', saveSaleEdit);
  document.getElementById('editSaleVoid')?.addEventListener('click', voidSale);
}

async function applyStockDelta(oldBreakdown, newBreakdown) {
  const allIds = new Set([...Object.keys(oldBreakdown), ...Object.keys(newBreakdown)]);
  for (const id of allIds) {
    const oldQty = oldBreakdown[id] || 0;
    const newQty = newBreakdown[id] || 0;
    const delta = newQty - oldQty;
    if (delta === 0) continue;
    inventory[id] = Math.max(0, inventory[id] - delta);
    await sbFetch(`inventory?category_id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stock: inventory[id], updated_at: new Date().toISOString() }),
    });
    const el = document.getElementById(`inv-count-${id}`);
    if (el) el.textContent = inventory[id];
  }
  writeCache(
    'inventory',
    CATEGORIES.map((c) => ({ category_id: c.id, stock: inventory[c.id] })),
  );
}

async function saveSaleEdit() {
  if (!editingSaleId || editSaleItems.length === 0) return;

  if (editSaleIsCredit && !editSaleClientName.trim()) {
    showToast('Credit orders need a client name', true);
    return;
  }

  const sale = salesCache.find((s) => s.id === editingSaleId);
  if (!sale) return;

  const oldBreakdown = mergeItemBreakdown(sale.items || []);
  const newBreakdown = mergeItemBreakdown(editSaleItems);
  const total = saleItemsTotal(editSaleItems);

  let clientId = editSaleClientId || null;
  if (editSaleClientName.trim()) {
    clientId = clientId || (await resolveClientId(editSaleClientName.trim()));
  } else {
    clientId = null;
  }

  const payload = {
    items: editSaleItems,
    total_ugx: total,
    client_id: clientId,
    is_credit: editSaleIsCredit,
    credit_cleared: editSaleIsCredit ? editSaleCreditCleared : true,
    cleared_at: editSaleIsCredit && editSaleCreditCleared ? sale.cleared_at || new Date().toISOString() : null,
  };

  try {
    await applyStockDelta(oldBreakdown, newBreakdown);

    const res = await sbFetch(`sales?id=eq.${editingSaleId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);

    Object.assign(sale, payload);
    editingSaleId = null;
    closeEditModal();
    clearCache('sales');
    showToast('Order updated');
    await loadSalesToday();
    renderAnalytics();
    const { updateTodayStrip } = await import('./home.js');
    updateTodayStrip();
  } catch (e) {
    console.error('save sale failed', e);
    showToast('Could not save order', true);
  }
}

async function voidSale() {
  if (!editingSaleId) return;
  const ok = await showConfirm('Void this order and restore stock?');
  if (!ok) return;

  const sale = salesCache.find((s) => s.id === editingSaleId);
  if (!sale) return;

  const oldBreakdown = mergeItemBreakdown(sale.items || []);

  try {
    await applyStockDelta(oldBreakdown, {});

    const res = await sbFetch(`sales?id=eq.${editingSaleId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);

    const idx = salesCache.findIndex((s) => s.id === editingSaleId);
    if (idx > -1) salesCache.splice(idx, 1);

    editingSaleId = null;
    closeEditModal();
    clearCache('sales');
    showToast('Order voided');
    await loadSalesToday();
    renderAnalytics();
    const { updateTodayStrip } = await import('./home.js');
    updateTodayStrip();
  } catch (e) {
    console.error('void sale failed', e);
    showToast('Could not void order', true);
  }
}
