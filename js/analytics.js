import { dataStore } from './store/index.js';
import { sbDelete, sbFetch } from './api.js';
import { CATEGORIES, LOW_STOCK_THRESHOLD } from './config.js';
import {
  breakdownToConfigSelection,
  buildLineFromConfig,
  clearManualQtyEdit,
  findProduct,
  renderProductConfigView,
  renderProductPickList,
  wireProductConfigView,
  wireProductPickButtons,
} from './product-config.js';
import { applyActiveHighlight, cookieStockLevel, getActiveStatusHighlight } from './inventory.js';
import { animateAccordionPanel, animateFlavorMeter, animateModalContent, applyBarFillWidths, isModalOpen, readFlavorMeterScale, setAccordionPanelInstant } from './animations.js';
import {
  filterSalesByInsightPeriod,
  getChartRange,
  getInsightPeriod,
  INSIGHT_PERIODS,
  mondayOfWeek,
  renderRevenueChart,
  renderSalesPatterns,
  setInsightPeriod,
} from './analytics-chart.js';
import { resolveClientId } from './clients.js';
import { clientAutocompleteMarkup, wireClientAutocomplete } from './client-autocomplete.js';
import { itemOwnerRevenue, saleOwnerRevenue, sumOwnerRevenue } from './revenue.js';
import { clients, inventory, salesCache } from './state.js';
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
} from './utils.js';
import {
  analyticsOverviewPlaceholder,
  barRowPlaceholders,
  fixedItemPlaceholders,
  showPlaceholder,
} from './pending.js';
import { createMemo, salesFingerprint } from './store/memo.js';

const memoOverview = createMemo();

let editingSaleId = null;
let editSaleItems = [];
let editSaleClientId = '';
let editSaleClientName = '';
let editSaleIsCredit = false;
let editSaleCreditCleared = false;
let editSaleMode = 'main';
let editConfigProduct = null;
let editConfigSelection = {};
let editingSaleItemIdx = null;
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

function insightPeriodPillsHtml(activeId) {
  return INSIGHT_PERIODS.map(
    (p) =>
      `<button type="button" class="rev-range-btn${p.id === activeId ? ' active' : ''}" data-insight-period="${p.id}">${p.short}</button>`,
  ).join('');
}

function paintInsightPeriodPills(container, period) {
  if (!container) return;
  container.innerHTML = insightPeriodPillsHtml(period.id);
}

function wireInsightPeriodPills(root = document) {
  root.querySelectorAll('[data-insight-period]').forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) return;
    btn.addEventListener('click', () => {
      const id = btn.dataset.insightPeriod;
      if (!id || id === getInsightPeriod().id) return;
      setInsightPeriod(id);
      renderInsightDependent();
    });
  });
}

function renderInsightDependent() {
  renderOverviewSections();
  renderInsightLists();
}

function topProductForSales(sales) {
  const productTotals = {};
  sales.forEach((s) =>
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
  return { topProduct, topCount };
}

function renderOverviewSections() {
  if (showPlaceholder('sales', salesCache.length)) {
    document.getElementById('statCards').innerHTML = analyticsOverviewPlaceholder();
    return;
  }

  const period = getInsightPeriod();
  const metrics = memoOverview(`${salesFingerprint(salesCache)}:${clients.length}:${period.id}`, () => {
    const todaySales = salesCache.filter((s) => isToday(s.created_at));
    const revenueToday = sumOwnerRevenue(todaySales);
    const revenueAll = sumOwnerRevenue(salesCache);
    const ordersCount = salesCache.length;
    const avgOrder = ordersCount > 0 ? revenueAll / ordersCount : 0;

    const now = new Date();
    const weekStart = mondayOfWeek(now);
    const revenueWeek = salesCache
      .filter((s) => new Date(s.created_at) >= weekStart)
      .reduce((sum, s) => sum + saleOwnerRevenue(s), 0);
    const revenueMonth = salesCache
      .filter((s) => {
        const d = new Date(s.created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((sum, s) => sum + saleOwnerRevenue(s), 0);

    const periodSales = filterSalesByInsightPeriod(salesCache, period);
    const { topProduct, topCount } = topProductForSales(periodSales);

    const outstandingCredit = salesCache.filter((s) => s.is_credit && !s.credit_cleared);
    const totalCreditOwed = outstandingCredit.reduce((sum, s) => sum + s.total_ugx, 0);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayRev = salesCache
      .filter((s) => isSameDay(new Date(s.created_at), yesterday))
      .reduce((sum, s) => sum + saleOwnerRevenue(s), 0);
    const delta = revenueDelta(revenueToday, yesterdayRev);
    const monthShare = revenueAll > 0 ? Math.round((revenueMonth / revenueAll) * 100) : 0;
    const ordersToday = todaySales.length;

    return {
      revenueToday,
      revenueAll,
      ordersCount,
      avgOrder,
      revenueWeek,
      revenueMonth,
      topProduct,
      topCount,
      outstandingCredit,
      totalCreditOwed,
      delta,
      monthShare,
      ordersToday,
      period,
    };
  });

  if (metrics.outstandingCredit.length === 0) creditPanelOpen = false;

  const {
    revenueToday,
    revenueAll,
    ordersCount,
    avgOrder,
    revenueWeek,
    revenueMonth,
    topProduct,
    topCount,
    outstandingCredit,
    totalCreditOwed,
    delta,
    monthShare,
    ordersToday,
  } = metrics;

  const favoriteSub =
    topCount > 0
      ? `${topCount} unit${topCount === 1 ? '' : 's'} ordered · ${period.id === 'all' ? 'all time' : period.label.toLowerCase()}`
      : 'No orders yet';

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
        <div class="ao-feature-head">
          <div class="ao-feature-kicker">Customer favorite</div>
          <div class="insight-period-pills" role="group" aria-label="Customer favorite period">
            ${insightPeriodPillsHtml(period.id)}
          </div>
        </div>
        <div class="ao-feature-title">${escapeHtml(topProduct)}</div>
        <div class="ao-feature-sub">${favoriteSub}</div>
      </div>
    </div>

    ${renderCreditPanel(outstandingCredit, totalCreditOwed)}
  `;

  applyBarFillWidths(document.getElementById('statCards'));
  wireCreditPanel();
  wireInsightPeriodPills(document.getElementById('statCards'));
}

function renderInsightLists() {
  const period = getInsightPeriod();
  const periodSales = filterSalesByInsightPeriod(salesCache, period);
  const periodSuffix = period.id === 'all' ? 'all time' : period.label.toLowerCase();

  const productPeriodEl = document.getElementById('productRevenuePeriod');
  const clientsPeriodEl = document.getElementById('topClientsPeriod');
  paintInsightPeriodPills(productPeriodEl, period);
  paintInsightPeriodPills(clientsPeriodEl, period);
  wireInsightPeriodPills(productPeriodEl);
  wireInsightPeriodPills(clientsPeriodEl);

  const productRevenueMap = {};
  periodSales.forEach((s) =>
    (s.items || []).forEach((i) => {
      productRevenueMap[i.product_name] = (productRevenueMap[i.product_name] || 0) + itemOwnerRevenue(i);
    }),
  );
  const sortedProducts = Object.entries(productRevenueMap).sort((a, b) => b[1] - a[1]);
  const maxProdRev = Math.max(1, ...sortedProducts.map(([, v]) => v));
  const productRevenueEl = document.getElementById('productRevenue');
  if (productRevenueEl) {
    productRevenueEl.innerHTML =
      sortedProducts.length === 0
        ? showPlaceholder('sales', periodSales.length)
          ? barRowPlaceholders(4, true)
          : `<div class="receipt-empty">No sales ${period.id === 'all' ? 'yet' : `this ${periodSuffix}`}</div>`
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
  periodSales.forEach((s) => {
    if (!s.client_id) return;
    if (!clientTotals[s.client_id]) clientTotals[s.client_id] = { revenue: 0, orders: 0 };
    clientTotals[s.client_id].revenue += saleOwnerRevenue(s);
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
        ? showPlaceholder('sales', periodSales.length)
          ? fixedItemPlaceholders(3)
          : `<div class="receipt-empty">No client-attributed sales ${period.id === 'all' ? 'yet' : `this ${periodSuffix}`}</div>`
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

function renderRangeSections() {
  const range = getChartRange();

  renderRevenueChart(document.getElementById('revenueChart'), salesCache, range, () => renderAnalyticsCharts());
  renderSalesPatterns(document.getElementById('salesPatterns'), salesCache);
  renderInsightLists();
}

export function renderAnalyticsOverview() {
  renderOverviewSections();
}

export function renderAnalyticsCharts() {
  renderRangeSections();
}

export function renderAnalyticsStock() {
  const jointCats = CATEGORIES.filter((c) => c.id !== 'cookie');
  const maxJointStock = Math.max(1, ...jointCats.map((c) => inventory[c.id]));
  const stockPending = showPlaceholder('inventory');
  const stockBars = document.getElementById('stockBars');
  if (!stockBars) return;

  stockBars.innerHTML = CATEGORIES.map((c) => {
    const stock = inventory[c.id];
    let status;
    let pct;
    if (c.id === 'cookie') {
      const meter = cookieStockLevel(stock);
      status = meter.state;
      pct = meter.pct;
    } else {
      status = stock === 0 ? 'out' : stock < LOW_STOCK_THRESHOLD ? 'low' : 'ok';
      pct = Math.round((stock / maxJointStock) * 100);
    }
    const label = c.sub ? `${c.name} ${c.sub}` : c.name;
    return `<div class="bar-row" data-status="${status}">
      <div class="bar-label">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${stockPending ? 0 : pct}%; background:${c.color};"></div></div>
      <div class="bar-value${stockPending ? ' is-pending' : ''}" style="${!stockPending && status !== 'ok' ? `color:var(--${status === 'low' ? 'gold' : 'danger'});` : ''}">${stockPending ? '··' : stock}</div>
    </div>`;
  }).join('');
  applyActiveHighlight();
  applyBarFillWidths(stockBars);
}

export function renderAnalytics() {
  renderAnalyticsOverview();
  renderAnalyticsCharts();
  renderAnalyticsStock();
}

async function refreshAfterSaleEdit() {
  renderAnalytics();
  try {
    const { renderOrderHistory } = await import('./order-history.js');
    renderOrderHistory();
  } catch {
    /* history page module unused on analytics */
  }
  try {
    const { updateTodayStrip } = await import('./home.js');
    updateTodayStrip();
  } catch {
    /* home strip unused off home */
  }
}

async function clearCredit(saleId) {
  const ok = await showConfirm('Mark this credit as cleared?');
  if (!ok) return;
  try {
    const clearedAt = new Date().toISOString();
    const res = await sbFetch(`sales?id=eq.${saleId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ credit_cleared: true, cleared_at: clearedAt }),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Clear blocked — no rows updated');
    }
    const local = salesCache.find((s) => s.id === saleId);
    if (local) {
      local.credit_cleared = true;
      local.cleared_at = clearedAt;
    }
    await dataStore.invalidate('sales');
    showToast('Credit cleared');
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

function resetEditSaleConfig() {
  editSaleMode = 'main';
  editConfigProduct = null;
  editConfigSelection = {};
  editingSaleItemIdx = null;
}

function getEditSaleDraftStock(excludeIdx = -1) {
  const reserved = mergeItemBreakdown(editSaleItems.filter((_, i) => i !== excludeIdx));
  const stock = {};
  CATEGORIES.forEach((c) => {
    stock[c.id] = inventory[c.id] + (reserved[c.id] || 0);
  });
  return stock;
}

export function openEditSale(saleId) {
  const sale = salesCache.find((s) => s.id === saleId);
  if (!sale) return;

  editingSaleId = saleId;
  editSaleItems = (sale.items || []).map((i) => ({ ...i, breakdown: { ...(i.breakdown || {}) } }));
  editSaleClientId = sale.client_id || '';
  editSaleClientName = sale.client_id ? clients.find((c) => c.id === sale.client_id)?.name || '' : '';
  editSaleIsCredit = !!sale.is_credit;
  editSaleCreditCleared = !!sale.credit_cleared;
  resetEditSaleConfig();

  renderEditSaleModal();
  openEditModal();
}

function renderEditSaleModal() {
  if (editSaleMode === 'pick') renderEditSalePickView();
  else if (editSaleMode === 'config') renderEditSaleConfigView();
  else renderEditSaleMainView();
}

function renderEditSaleMainView() {
  const body = document.getElementById('editModalBody');
  if (!body) return;

  const sale = salesCache.find((s) => s.id === editingSaleId);
  const time = sale ? new Date(sale.created_at).toLocaleString() : '';
  const total = saleItemsTotal(editSaleItems);

  const itemRows =
    editSaleItems.length === 0
      ? `<div class="cart-empty">No items — add items below or void this order</div>`
      : editSaleItems
          .map(
            (item, idx) => `
        <div class="cart-item">
          <div class="cart-item-main">
            <div class="ci-name">${escapeHtml(item.product_name)}</div>
            <div class="ci-detail">${escapeHtml(item.detail || '')}</div>
          </div>
          <div class="cart-item-actions">
            <div class="ci-price">${fmtUGX(item.line_total)}</div>
            <div class="cart-item-btns">
              <button class="cart-edit" data-edit-sale-item="${idx}" type="button" title="Edit item" aria-label="Edit ${escapeHtml(item.product_name)}">✎</button>
              <button class="cart-remove" data-remove-sale-item="${idx}" type="button" aria-label="Remove ${escapeHtml(item.product_name)}">✕</button>
            </div>
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
      <div class="client-picker__head">
        <label for="editSaleClient">Client</label>
        <button
          type="button"
          id="editSaleCredit"
          class="credit-chip${editSaleIsCredit ? ' is-on' : ''}"
          role="switch"
          aria-checked="${editSaleIsCredit ? 'true' : 'false'}"
          title="Record as unpaid credit sale"
        >
          <span class="credit-chip__dot" aria-hidden="true"></span>
          <span class="credit-chip__text">Credit</span>
        </button>
      </div>
      ${clientAutocompleteMarkup({
        inputId: 'editSaleClient',
        dropdownId: 'editSaleClientDropdown',
        clearId: 'editSaleClientClear',
        value: editSaleClientName,
        placeholder: 'Client name (optional)',
      })}
      <div class="credit-warning" id="editSaleCreditWarning" ${editSaleIsCredit && !editSaleClientName.trim() ? '' : 'hidden'}>Select a client before recording credit</div>
      ${
        editSaleIsCredit
          ? `<button
              type="button"
              id="editSaleCreditCleared"
              class="credit-chip credit-chip--cleared${editSaleCreditCleared ? ' is-on' : ''}"
              role="switch"
              aria-checked="${editSaleCreditCleared ? 'true' : 'false'}"
              title="Mark credit as paid / cleared"
            >
              <span class="credit-chip__dot" aria-hidden="true"></span>
              <span class="credit-chip__text">${editSaleCreditCleared ? 'Cleared' : 'Unpaid'}</span>
            </button>`
          : ''
      }
    </div>
    ${itemRows}
    <button class="add-item-btn" id="editSaleAddItem" type="button">+ Add item</button>
    <div class="cart-total-row">
      <div class="ct-label">Total</div>
      <div class="ct-val">${fmtUGX(total)}</div>
    </div>
    <div class="modal-btns">
      <button class="modal-btn cancel" id="editSaleVoid" type="button">Void order</button>
      <button class="modal-btn cancel" id="editSaleCancel" type="button">Cancel</button>
      <button class="modal-btn confirm" id="editSaleSave" type="button" ${editSaleItems.length ? '' : 'disabled'}>Save</button>
    </div>`;

  animateEditModalBody(body);

  document.getElementById('editSaleClose')?.addEventListener('click', () => {
    resetEditSaleConfig();
    closeEditModal();
  });
  document.getElementById('editSaleCancel')?.addEventListener('click', () => {
    resetEditSaleConfig();
    closeEditModal();
  });
  wireClientAutocomplete({
    inputId: 'editSaleClient',
    dropdownId: 'editSaleClientDropdown',
    clearId: 'editSaleClientClear',
    onChange: (name, client) => {
      editSaleClientName = name;
      editSaleClientId = client?.id || '';
      const warning = document.getElementById('editSaleCreditWarning');
      if (warning) warning.hidden = !(editSaleIsCredit && !editSaleClientName.trim());
    },
  });
  document.getElementById('editSaleCredit')?.addEventListener('click', () => {
    editSaleIsCredit = !editSaleIsCredit;
    // Paid → credit should start unpaid; leaving credit restores paid (cleared).
    editSaleCreditCleared = !editSaleIsCredit;
    renderEditSaleModal();
  });
  document.getElementById('editSaleCreditCleared')?.addEventListener('click', () => {
    editSaleCreditCleared = !editSaleCreditCleared;
    renderEditSaleModal();
  });
  body.querySelectorAll('[data-edit-sale-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.editSaleItem, 10);
      const item = editSaleItems[idx];
      if (!item) return;
      const product = findProduct(item.product_id);
      if (!product) {
        showToast('Unknown product — remove and re-add this item', true);
        return;
      }
      editingSaleItemIdx = idx;
      editConfigProduct = product;
      editConfigSelection = breakdownToConfigSelection(product, item.breakdown);
      clearManualQtyEdit();
      editSaleMode = 'config';
      renderEditSaleModal();
    });
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
  document.getElementById('editSaleAddItem')?.addEventListener('click', () => {
    editingSaleItemIdx = null;
    editSaleMode = 'pick';
    renderEditSaleModal();
  });
  document.getElementById('editSaleSave')?.addEventListener('click', saveSaleEdit);
  document.getElementById('editSaleVoid')?.addEventListener('click', () => voidSale());
}

function renderEditSalePickView() {
  const body = document.getElementById('editModalBody');
  if (!body) return;

  body.innerHTML = renderProductPickList({
    backId: 'editSalePickBack',
    backLabel: 'Back to order',
  });

  animateEditModalBody(body);

  document.getElementById('productPickClose')?.addEventListener('click', () => {
    editSaleMode = 'main';
    renderEditSaleModal();
  });
  document.getElementById('editSalePickBack')?.addEventListener('click', () => {
    editSaleMode = 'main';
    renderEditSaleModal();
  });
  wireProductPickButtons(body, (productId) => {
    editConfigProduct = findProduct(productId);
    editConfigSelection = {};
    editingSaleItemIdx = null;
    clearManualQtyEdit();
    editSaleMode = 'config';
    renderEditSaleModal();
  });
}

function renderEditSaleConfigView() {
  const body = document.getElementById('editModalBody');
  if (!body || !editConfigProduct) return;

  const flavorList = body.querySelector('.flavor-list');
  const scrollTop = flavorList?.scrollTop ?? 0;
  const activeFlavor = document.activeElement?.closest?.('[data-flavor]')?.dataset?.flavor;
  const activeStep = document.activeElement?.matches?.('button.flavor-step')
    ? document.activeElement.dataset.pdir
    : null;
  const prevMeter = body.querySelector('.flavor-meter__fill');
  const fromMeter = prevMeter ? readFlavorMeterScale(prevMeter) : 0;
  const hadMeter = Boolean(prevMeter);

  const draftStock = getEditSaleDraftStock(editingSaleItemIdx ?? -1);
  body.innerHTML = renderProductConfigView(
    editConfigProduct,
    editConfigSelection,
    draftStock,
    editingSaleItemIdx !== null,
  );

  if (!hadMeter) animateEditModalBody(body);

  const nextList = body.querySelector('.flavor-list');
  if (nextList) nextList.scrollTop = scrollTop;

  const qtyEdit = body.querySelector('[data-qty-edit]');
  if (qtyEdit) {
    qtyEdit.focus({ preventScroll: true });
    const len = qtyEdit.value.length;
    qtyEdit.setSelectionRange(len, len);
  } else if (activeFlavor != null) {
    const sel = activeStep != null
      ? `button.flavor-step[data-pick="${activeFlavor}"][data-pdir="${activeStep}"]`
      : `[data-flavor="${activeFlavor}"]`;
    body.querySelector(sel)?.focus?.({ preventScroll: true });
  }

  const fill = body.querySelector('.flavor-meter__fill');
  if (fill) {
    const toMeter = Math.max(0, Math.min(1, parseFloat(fill.dataset.meter) || 0));
    animateFlavorMeter(fill, { from: hadMeter ? fromMeter : 0, to: toMeter });
  }

  document.getElementById('productConfigClose')?.addEventListener('click', () => {
    editSaleMode = 'main';
    editConfigProduct = null;
    editConfigSelection = {};
    editingSaleItemIdx = null;
    renderEditSaleModal();
  });

  wireProductConfigView(body, {
    configSelection: editConfigSelection,
    onBack: () => {
      editSaleMode = editingSaleItemIdx !== null ? 'main' : 'pick';
      editConfigProduct = null;
      editConfigSelection = {};
      editingSaleItemIdx = null;
      renderEditSaleModal();
    },
    onConfirm: confirmEditSaleConfig,
    onRerender: renderEditSaleConfigView,
  });
}

function confirmEditSaleConfig() {
  const product = editConfigProduct;
  if (!product) return;

  const { breakdown, lineTotal, detail } = buildLineFromConfig(product, editConfigSelection);
  const saleItem = {
    product_id: product.id,
    product_name: product.name,
    detail,
    line_total: lineTotal,
    breakdown,
  };

  if (editingSaleItemIdx !== null) {
    editSaleItems[editingSaleItemIdx] = saleItem;
  } else {
    editSaleItems.push(saleItem);
  }

  editConfigProduct = null;
  editConfigSelection = {};
  editingSaleItemIdx = null;
  editSaleMode = 'main';
  renderEditSaleModal();
}

function animateEditModalBody(body) {
  const editOverlay = document.getElementById('editOverlay');
  if (isModalOpen(editOverlay)) animateModalContent(body);
}

async function applyStockDelta(oldBreakdown, newBreakdown, { persistLocal = true } = {}) {
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
  if (persistLocal) await dataStore.persistCurrent('inventory');
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
    await applyStockDelta(oldBreakdown, newBreakdown, { persistLocal: false });

    const res = await sbFetch(`sales?id=eq.${editingSaleId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);

    Object.assign(sale, payload);
    editingSaleId = null;
    resetEditSaleConfig();
    closeEditModal();
    await Promise.all([dataStore.invalidate('sales'), dataStore.invalidate('inventory')]);
    showToast('Order updated');
    await refreshAfterSaleEdit();
  } catch (e) {
    console.error('save sale failed', e);
    showToast('Could not save order', true);
  }
}

async function voidSale() {
  const saleId = editingSaleId;
  if (!saleId) return;

  const sale = salesCache.find((s) => s.id === saleId);
  if (!sale) return;

  const snapshot = {
    id: saleId,
    items: (sale.items || []).map((i) => ({ ...i, breakdown: { ...(i.breakdown || {}) } })),
  };

  resetEditSaleConfig();
  editingSaleId = null;
  closeEditModal();

  const ok = await showConfirm('Void this order and restore stock?');
  if (!ok) return;

  await performVoidSale(snapshot);
}

async function performVoidSale(snapshot) {
  const oldBreakdown = mergeItemBreakdown(snapshot.items);

  try {
    // CASCADE on deliveries.sale_id removes the linked delivery quote.
    await sbDelete(`sales?id=eq.${snapshot.id}`);
    await applyStockDelta(oldBreakdown, {}, { persistLocal: false });

    const [salesRes, invRes, delRes] = await Promise.all([
      dataStore.invalidate('sales'),
      dataStore.invalidate('inventory'),
      dataStore.invalidate('deliveries'),
    ]);

    if (!salesRes.ok || !invRes.ok || !delRes.ok) {
      await dataStore.recoverFromServer(['sales', 'inventory', 'deliveries']);
      if (!salesRes.ok || !invRes.ok || !delRes.ok) throw new Error('Sync failed after void');
    }

    showToast('Order voided');
    await refreshAfterSaleEdit();
  } catch (e) {
    console.error('void sale failed', e);
    await dataStore.recoverFromServer(['sales', 'inventory', 'deliveries']).catch(() => {});
    await refreshAfterSaleEdit();
    showToast('Could not void order', true);
  }
}
