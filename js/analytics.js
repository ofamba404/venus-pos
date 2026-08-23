import { dataStore } from './store/index.js';
import { sbDelete, sbFetch } from './api.js';
import { CATEGORIES, COOKIE_FLAVORS, COOKIE_STOCK_CAPACITY, LOW_STOCK_THRESHOLD, isCookieCategoryId, cookieLineDisplayName, normalizeInventoryBreakdown } from './config.js';
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
import { applyToCartLines } from './flavored-cookie-pricing.js';
import { applyActiveHighlight, getActiveStatusHighlight } from './inventory.js';
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
import {
  creditBalance,
  getOutstandingCredit,
  groupOutstandingByClient,
  sumCreditOwed,
} from './credit.js';
import { settleClientCredit, settleSaleCredit } from './settle-credit.js';
import {
  cookieBatchLineTitle,
  cookieFlavorMixPhrase,
  cookiePartnerSettlementSummary,
  cookiePartnerShareText,
  itemFlavorOwnerShares,
  itemOwnerRevenue,
  markCookiePartnerBatchesSent,
  salePaidRatio,
  saleRecognizedOwnerRevenue,
  sumOwnerRevenue,
} from './revenue.js';
import { clients, inventory, salesCache } from './state.js';
import {
  closeEditModal,
  clientInitials,
  copyText,
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
  rankRowPlaceholders,
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
/** Client keys with order details expanded inside the credit panel. */
const creditGroupOpen = new Set();

function creditOrderDate(sale) {
  return new Date(sale.created_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function creditOrderBalanceLabel(sale, { multi = false } = {}) {
  const balance = creditBalance(sale);
  const total = Number(sale.total_ugx) || 0;
  const paid = Math.max(0, Number(sale.amount_paid_ugx) || 0);
  const date = creditOrderDate(sale);
  if (paid > 0 && balance > 0) {
    return multi
      ? `${fmtUGX(balance)} left of ${fmtUGX(total)} · ${date}`
      : `${fmtUGX(balance)} left of ${fmtUGX(total)} · since ${date}`;
  }
  return multi ? `${fmtUGX(balance)} · ${date}` : `${fmtUGX(balance)} · since ${date}`;
}

function renderCreditClientGroup(group) {
  const multi = group.sales.length > 1;
  const groupKey = group.key;
  const open = multi && creditGroupOpen.has(groupKey);
  const payTarget = multi
    ? `data-pay-client-credit="${escapeHtml(group.clientId)}"`
    : `data-pay-credit="${group.sales[0].id}"`;

  const headMeta = multi
    ? `${fmtUGX(group.totalUgx)} · ${group.sales.length} orders`
    : creditOrderBalanceLabel(group.sales[0]);

  const orderRows = multi
    ? group.sales
        .map(
          (s) => `
        <div class="credit-panel-order">
          <div class="cr-meta">${creditOrderBalanceLabel(s, { multi: true })}</div>
          <button class="credit-clear-btn" data-pay-credit="${s.id}" type="button">Clear</button>
        </div>`,
        )
        .join('')
    : '';

  return `
    <div class="credit-client-group${multi ? ' is-multi' : ''}${open ? ' is-open' : ''}" data-credit-group="${escapeHtml(groupKey)}">
      <div class="credit-panel-item credit-client-head"${multi ? ` role="button" tabindex="0" aria-expanded="${open}"` : ''}>
        <div class="credit-panel-avatar" aria-hidden="true">${escapeHtml(clientInitials(group.name))}</div>
        <div class="credit-panel-item-main">
          <div class="cr-name">${escapeHtml(group.name)}</div>
          <div class="cr-meta">${headMeta}</div>
        </div>
        ${multi ? `<span class="credit-group-caret" aria-hidden="true">▸</span>` : ''}
        <button class="credit-clear-btn" ${payTarget} type="button">Clear</button>
      </div>
      ${multi ? `<div class="credit-client-orders${open ? '' : ' is-collapsed'}"${open ? '' : ' hidden'}>${orderRows}</div>` : ''}
    </div>`;
}

function renderCreditPanel(outstandingCredit, totalCreditOwed) {
  const groups = groupOutstandingByClient(outstandingCredit, clients);
  const uniqueClients = groups.length;

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

  const previewNames = groups.map((g) => g.name).slice(0, 3);
  const preview =
    previewNames.length > 0
      ? `<div class="credit-panel-chips">${previewNames
          .map((name) => `<span class="credit-chip">${escapeHtml(name)}</span>`)
          .join('')}${uniqueClients > 3 ? `<span class="credit-chip more">+${uniqueClients - 3}</span>` : ''}</div>`
      : '';

  const rows = groups.map(renderCreditClientGroup).join('');
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

  const toggleGroup = (groupEl) => {
    if (!groupEl?.classList.contains('is-multi')) return;
    const key = groupEl.dataset.creditGroup;
    if (!key) return;
    const open = !creditGroupOpen.has(key);
    if (open) creditGroupOpen.add(key);
    else creditGroupOpen.delete(key);
    groupEl.classList.toggle('is-open', open);
    const head = groupEl.querySelector('.credit-client-head');
    head?.setAttribute('aria-expanded', String(open));
    const orders = groupEl.querySelector('.credit-client-orders');
    if (orders) {
      orders.hidden = !open;
      orders.classList.toggle('is-collapsed', !open);
    }
  };

  panel.querySelectorAll('.credit-client-group.is-multi .credit-client-head').forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('.credit-clear-btn')) return;
      toggleGroup(head.closest('.credit-client-group'));
    });
    head.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.credit-clear-btn')) return;
      e.preventDefault();
      toggleGroup(head.closest('.credit-client-group'));
    });
  });

  panel.querySelectorAll('[data-pay-credit]').forEach((payBtn) => {
    payBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await settleSaleCredit(payBtn.dataset.payCredit);
      if (ok) renderAnalytics();
    });
  });

  panel.querySelectorAll('[data-pay-client-credit]').forEach((payBtn) => {
    payBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await settleClientCredit(payBtn.dataset.payClientCredit);
      if (ok) renderAnalytics();
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
  if (!root) return;
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
  const statCards = document.getElementById('statCards');
  if (!statCards) return;

  if (showPlaceholder('sales', salesCache.length)) {
    statCards.innerHTML = analyticsOverviewPlaceholder();
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
      .reduce((sum, s) => sum + saleRecognizedOwnerRevenue(s), 0);
    const revenueMonth = salesCache
      .filter((s) => {
        const d = new Date(s.created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((sum, s) => sum + saleRecognizedOwnerRevenue(s), 0);

    const periodSales = filterSalesByInsightPeriod(salesCache, period);
    const { topProduct, topCount } = topProductForSales(periodSales);

    const outstandingCredit = getOutstandingCredit(salesCache);
    const totalCreditOwed = sumCreditOwed(outstandingCredit);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayRev = salesCache
      .filter((s) => isSameDay(new Date(s.created_at), yesterday))
      .reduce((sum, s) => sum + saleRecognizedOwnerRevenue(s), 0);
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

  if (metrics.outstandingCredit.length === 0) {
    creditPanelOpen = false;
    creditGroupOpen.clear();
  } else {
    const liveKeys = new Set(
      groupOutstandingByClient(metrics.outstandingCredit, clients).map((g) => g.key),
    );
    for (const key of [...creditGroupOpen]) {
      if (!liveKeys.has(key)) creditGroupOpen.delete(key);
    }
  }

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

  statCards.innerHTML = `
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
        </div>
        <div class="ao-tile-value">${fmtCompact(revenueMonth)}</div>
        <div class="ao-tile-foot">${monthShare}% of lifetime</div>
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

  applyBarFillWidths(statCards);
  wireCreditPanel();
  wireInsightPeriodPills(statCards);
  renderCookiePartnerPanel();
}

function flavorDotColor(flavorId) {
  return COOKIE_FLAVORS.find((f) => f.id === flavorId)?.color || '#D4A355';
}

function fmtPlainUgx(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function cookiePartnerLineDots(row) {
  if (row.kind === 'single') {
    return `<span class="cookie-partner-dot" style="background:${flavorDotColor(row.flavorId)}"></span>`;
  }
  return COOKIE_FLAVORS.flatMap((f) => {
    const n = row.flavorCounts?.[f.id] || 0;
    return Array.from({ length: n }, () => `<span class="cookie-partner-dot" style="background:${f.color}"></span>`);
  }).join('');
}

function renderCookiePartnerSoldLines(batch) {
  return (batch.lines || [])
    .map((row) => {
      const mix = row.kind === 'single' ? '' : cookieFlavorMixPhrase(row.flavorCounts);
      return `
        <div class="cookie-partner-line">
          <div class="cookie-partner-line-qty">${row.qty}</div>
          <div class="cookie-partner-line-body">
            <div class="cookie-partner-line-name">${escapeHtml(cookieBatchLineTitle(row))}</div>
            ${mix ? `<div class="cookie-partner-line-mix">${escapeHtml(mix)}</div>` : ''}
            <div class="cookie-partner-line-dots" aria-hidden="true">${cookiePartnerLineDots(row)}</div>
          </div>
          <div class="cookie-partner-line-amt">${fmtPlainUgx(row.revenue)}</div>
        </div>`;
    })
    .join('');
}

function renderCookiePartnerSold(s) {
  const batches = s.batches || [];
  if (!batches.length) return '';

  const soldLabel =
    batches.length === 1
      ? batches[0].complete
        ? 'Sold this batch'
        : 'Sold so far'
      : 'Sold by batch';

  const blocks = batches
    .map((batch, i) => {
      const kicker =
        batches.length > 1
          ? `<div class="cookie-partner-batch-kicker">${
              batch.complete ? `Batch ${i + 1}` : `Next cycle · ${batch.cookieCount} of ${batch.every}`
            }</div>`
          : '';
      return `
        <div class="cookie-partner-batch">
          ${kicker}
          <div class="cookie-partner-lines">${renderCookiePartnerSoldLines(batch)}</div>
          <div class="cookie-partner-sold-total">
            <span>${batch.cookieCount} cookie${batch.cookieCount === 1 ? '' : 's'}</span>
            <strong>${fmtPlainUgx(batch.revenue)}</strong>
          </div>
        </div>`;
    })
    .join('');

  return `
    <div class="cookie-partner-sold">
      <div class="cookie-partner-sold-head">
        <div class="cookie-partner-sold-label">${soldLabel}</div>
        <button type="button" class="cookie-partner-copy" data-cookie-partner-copy>Copy</button>
      </div>
      ${blocks}
    </div>`;
}

function renderCookiePartnerPanel() {
  const el = document.getElementById('cookiePartnerPanel');
  if (!el) return;

  if (showPlaceholder('sales', salesCache.length)) {
    el.innerHTML = `
      <div class="cookie-partner-card is-pending-card" aria-hidden="true">
        <div class="cookie-partner-kicker is-pending">····</div>
        <div class="cookie-partner-title is-pending">········</div>
      </div>`;
    return;
  }

  const s = cookiePartnerSettlementSummary(salesCache);
  const ready = s.readyBatches > 0;
  const progressPct = Math.min(100, Math.round((s.towardNext / s.every) * 100));
  const cycleLabel = ready
    ? `${s.readyCount} cookie${s.readyCount === 1 ? '' : 's'} ready to settle`
    : `${s.towardNext} of ${s.every} toward next send`;

  const showOwner = ready ? s.readyOwnerSplit : s.batchOwnerSplit;
  const showPartner = ready ? s.readyPartnerDue : s.batchPartnerDue;
  const showRevenue = ready ? s.readyRevenue : s.batchRevenue;

  el.innerHTML = `
    <div class="cookie-partner-card${ready ? ' is-ready' : ''}">
      <div class="cookie-partner-head">
        <div>
          <div class="cookie-partner-kicker">Settlement every ${s.every} cookies</div>
          <div class="cookie-partner-title">${cycleLabel}</div>
          <div class="cookie-partner-sub">${s.unsettledCount} unsettled · ${s.totalCookies} since Wed Aug 12</div>
        </div>
        ${
          ready
            ? `<button type="button" class="credit-clear-btn cookie-partner-send" data-cookie-partner-send>Mark sent</button>`
            : ''
        }
      </div>

      <div class="cookie-partner-track" aria-hidden="true">
        <div class="cookie-partner-fill" style="width:${ready ? 100 : progressPct}%"></div>
      </div>

      <div class="cookie-partner-grid">
        <div class="cookie-partner-stat">
          <div class="cookie-partner-stat-lbl">Your split</div>
          <div class="cookie-partner-stat-val">${fmtUGX(showOwner)}</div>
          <div class="cookie-partner-stat-hint">All flavors 45% of profit</div>
        </div>
        <div class="cookie-partner-stat cookie-partner-stat--partner">
          <div class="cookie-partner-stat-lbl">Send partner</div>
          <div class="cookie-partner-stat-val">${fmtUGX(showPartner)}</div>
          <div class="cookie-partner-stat-hint">Their revenue (sale − your split)</div>
        </div>
      </div>

      ${renderCookiePartnerSold(s)}

      <div class="cookie-partner-foot">
        ${
          s.batches?.length
            ? ''
            : `<span>Batch cookie sales <strong>${fmtCompact(showRevenue)}</strong></span>`
        }
        <span>Lifetime yours <strong>${fmtCompact(s.lifetimeOwnerSplit)}</strong> · partner <strong>${fmtCompact(s.lifetimePartnerDue)}</strong></span>
      </div>
    </div>`;

  el.querySelector('[data-cookie-partner-copy]')?.addEventListener('click', () => {
    const text = cookiePartnerShareText(s.batches);
    if (!text) return;
    void copyText(text, 'Copied for partner');
  });

  el.querySelector('[data-cookie-partner-send]')?.addEventListener('click', async () => {
    const ok = await showConfirm(
      `Mark partner paid? Send ${fmtUGX(s.readyPartnerDue)} for ${s.readyCount} cookies (your split ${fmtUGX(s.readyOwnerSplit)}).`,
    );
    if (!ok) return;
    markCookiePartnerBatchesSent(salesCache);
    showToast('Cookie partner batch marked sent');
    renderCookiePartnerPanel();
  });
}

function categoryLabel(c, { shortCookie = false } = {}) {
  if (shortCookie && isCookieCategoryId(c.id)) return c.name;
  return c.sub ? `${c.name} ${c.sub}` : c.name;
}

function sharePct(part, total) {
  if (!(total > 0)) return 0;
  return Math.round((part / total) * 100);
}

/** Soft full shelf for joints — fill is vs capacity, not vs the fullest SKU. */
const JOINT_STOCK_CAPACITY = Math.max(20, LOW_STOCK_THRESHOLD * 4);

function conicFromShares(rows, valueKey = 'revenue') {
  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);
  if (!(total > 0)) return 'var(--btn-bg)';
  let cursor = 0;
  const stops = [];
  rows.forEach((r) => {
    const v = Number(r[valueKey]) || 0;
    if (v <= 0) return;
    const start = cursor;
    const end = cursor + (v / total) * 100;
    stops.push(`${r.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    cursor = end;
  });
  return stops.length ? `conic-gradient(${stops.join(', ')})` : 'var(--btn-bg)';
}

function hbarRowsHtml(rows, { max, valueFmt, metaOf, colorOf, titleOf } = {}) {
  const ceiling = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.revenue ?? r.value ?? 0)));
  return rows
    .map((r) => {
      const value = r.revenue ?? r.value ?? 0;
      const pct = Math.round((value / ceiling) * 100);
      const color = colorOf ? colorOf(r) : r.color || 'var(--jade)';
      const meta = metaOf ? metaOf(r) : '';
      const title = titleOf ? titleOf(r) : '';
      return `
      <div class="hbar-row"${title ? ` title="${escapeHtml(title)}"` : ''}>
        <div class="hbar-label">
          ${r.color ? `<span class="hbar-swatch" style="background:${r.color}"></span>` : ''}
          <span class="hbar-name">${escapeHtml(r.label || r.name)}</span>
        </div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="hbar-meta">${meta ? `<span class="hbar-sub">${escapeHtml(meta)}</span>` : ''}<span class="hbar-val">${valueFmt(value, r)}</span></div>
      </div>`;
    })
    .join('');
}

function flavorDonutHtml(rows, { caption = 'cookies' } = {}) {
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  const gradient = conicFromShares(rows);
  const legend = rows
    .map((r) => {
      const qty = Math.round(r.qty);
      const share = sharePct(r.revenue, total);
      return `
      <div class="donut-leg-row" title="${escapeHtml(`${fmtUGX(r.revenue)} · ${qty} sold`)}">
        <span class="donut-leg-swatch" style="background:${r.color}"></span>
        <span class="donut-leg-name">${escapeHtml(r.label)}</span>
        <span class="donut-leg-share">${share}%</span>
        <span class="donut-leg-val">${fmtCompact(r.revenue)}</span>
      </div>`;
    })
    .join('');

  return `
    <div class="flavor-donut-panel">
      <div class="donut-container analytics-donut" aria-hidden="true">
        <div class="donut" style="background:${gradient}"></div>
        <div class="donut-hole">
          <div class="donut-total">${fmtCompact(total)}</div>
          <div class="donut-caption">${escapeHtml(caption)}</div>
        </div>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

function paretoRowsHtml(sortedEntries) {
  const total = sortedEntries.reduce((sum, [, rev]) => sum + rev, 0);
  const max = Math.max(1, ...sortedEntries.map(([, rev]) => rev));
  let cum = 0;
  return sortedEntries
    .map(([name, rev], i) => {
      cum += rev;
      const cumPct = sharePct(cum, total);
      const barPct = Math.round((rev / max) * 100);
      const hit80 = cumPct >= 80 && (i === 0 || sharePct(cum - rev, total) < 80);
      return `
      <div class="pareto-row${hit80 ? ' is-pareto-cut' : ''}" title="${escapeHtml(`${fmtUGX(rev)} · ${cumPct}% cumulative`)}">
        <div class="pareto-rank">${i + 1}</div>
        <div class="pareto-main">
          <div class="pareto-name">${escapeHtml(name)}</div>
          <div class="pareto-track"><div class="pareto-fill" style="width:${barPct}%"></div></div>
        </div>
        <div class="pareto-side">
          <span class="pareto-val">${fmtCompact(rev)}</span>
          <span class="pareto-cum">${cumPct}% cum</span>
        </div>
      </div>`;
    })
    .join('');
}

function insightGroupHtml(title, inner) {
  if (!inner) return '';
  return `<div class="insight-group">
    <div class="insight-kicker">${escapeHtml(title)}</div>
    ${inner}
  </div>`;
}

function insightSplitHtml(...groups) {
  const present = groups.filter(Boolean);
  if (!present.length) return '';
  if (present.length === 1) return present[0];
  return `<div class="insight-split">${present.join('')}</div>`;
}

function renderInsightLists() {
  const period = getInsightPeriod();
  const periodSales = filterSalesByInsightPeriod(salesCache, period);
  const periodSuffix = period.id === 'all' ? 'all time' : period.label.toLowerCase();

  const flavorPeriodEl = document.getElementById('flavorRevenuePeriod');
  const productPeriodEl = document.getElementById('productRevenuePeriod');
  const clientsPeriodEl = document.getElementById('topClientsPeriod');
  paintInsightPeriodPills(flavorPeriodEl, period);
  paintInsightPeriodPills(productPeriodEl, period);
  paintInsightPeriodPills(clientsPeriodEl, period);
  wireInsightPeriodPills(flavorPeriodEl);
  wireInsightPeriodPills(productPeriodEl);
  wireInsightPeriodPills(clientsPeriodEl);

  const flavorRevenueEl = document.getElementById('flavorRevenue');
  if (flavorRevenueEl) {
    const flavorMap = {};
    periodSales.forEach((s) => {
      const ratio = salePaidRatio(s);
      (s.items || []).forEach((i) => {
        itemFlavorOwnerShares(i).forEach((share) => {
          const row = flavorMap[share.catId] || { catId: share.catId, qty: 0, revenue: 0 };
          row.qty += share.qty * ratio;
          row.revenue += share.revenue * ratio;
          flavorMap[share.catId] = row;
        });
      });
    });

    const toRows = (cats) =>
      cats
        .map((c) => {
          const row = flavorMap[c.id];
          if (!row || row.revenue <= 0) return null;
          return {
            label: categoryLabel(c, { shortCookie: true }),
            color: c.color,
            qty: row.qty,
            revenue: row.revenue,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.revenue - a.revenue);

    const jointRows = toRows(CATEGORIES.filter((c) => !isCookieCategoryId(c.id)));
    const cookieRows = toRows(CATEGORIES.filter((c) => isCookieCategoryId(c.id)));

    const jointBars =
      jointRows.length === 0
        ? ''
        : hbarRowsHtml(jointRows, {
            valueFmt: (v) => fmtCompact(v),
            metaOf: (r) => `${Math.round(r.qty)} sold`,
            titleOf: (r) => `${fmtUGX(r.revenue)} · ${Math.round(r.qty)} sold`,
          });

    flavorRevenueEl.innerHTML =
      jointRows.length === 0 && cookieRows.length === 0
        ? showPlaceholder('sales', periodSales.length)
          ? insightSplitHtml(
              insightGroupHtml('Joints', rankRowPlaceholders(4, { swatch: true })),
              insightGroupHtml('Cookies', rankRowPlaceholders(3, { swatch: true })),
            )
          : `<div class="receipt-empty">No flavor sales ${period.id === 'all' ? 'yet' : `this ${periodSuffix}`}</div>`
        : insightSplitHtml(
            insightGroupHtml('Joints', jointBars),
            insightGroupHtml('Cookies', cookieRows.length ? flavorDonutHtml(cookieRows) : ''),
          );

    applyBarFillWidths(flavorRevenueEl);
  }

  const productRevenueMap = {};
  periodSales.forEach((s) => {
    const ratio = salePaidRatio(s);
    (s.items || []).forEach((i) => {
      productRevenueMap[i.product_name] =
        (productRevenueMap[i.product_name] || 0) + itemOwnerRevenue(i) * ratio;
    });
  });
  const sortedProducts = Object.entries(productRevenueMap).sort((a, b) => b[1] - a[1]);
  const productRevenueEl = document.getElementById('productRevenue');
  if (productRevenueEl) {
    productRevenueEl.innerHTML =
      sortedProducts.length === 0
        ? showPlaceholder('sales', periodSales.length)
          ? rankRowPlaceholders(4)
          : `<div class="receipt-empty">No sales ${period.id === 'all' ? 'yet' : `this ${periodSuffix}`}</div>`
        : `<div class="pareto-list">${paretoRowsHtml(sortedProducts)}</div>`;
    applyBarFillWidths(productRevenueEl);
  }

  const clientTotals = {};
  periodSales.forEach((s) => {
    if (!s.client_id) return;
    if (!clientTotals[s.client_id]) clientTotals[s.client_id] = { revenue: 0, orders: 0 };
    clientTotals[s.client_id].revenue += saleRecognizedOwnerRevenue(s);
    clientTotals[s.client_id].orders += 1;
  });
  const rankedClients = Object.entries(clientTotals)
    .map(([id, data]) => ({
      name: clients.find((c) => c.id === id)?.name || 'Unknown',
      label: clients.find((c) => c.id === id)?.name || 'Unknown',
      ...data,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  const topClientsEl = document.getElementById('topClients');
  if (topClientsEl) {
    topClientsEl.innerHTML =
      rankedClients.length === 0
        ? showPlaceholder('sales', periodSales.length)
          ? rankRowPlaceholders(3)
          : `<div class="receipt-empty">No client-attributed sales ${period.id === 'all' ? 'yet' : `this ${periodSuffix}`}</div>`
        : hbarRowsHtml(rankedClients, {
            valueFmt: (v) => fmtUGX(v),
            metaOf: (c) => `${c.orders} order${c.orders > 1 ? 's' : ''}`,
            colorOf: () => 'var(--jade)',
          });
    applyBarFillWidths(topClientsEl);
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
  const jointCats = CATEGORIES.filter((c) => !isCookieCategoryId(c.id));
  const cookieCats = CATEGORIES.filter((c) => isCookieCategoryId(c.id));
  const stockPending = showPlaceholder('inventory');
  const stockBars = document.getElementById('stockBars');
  if (!stockBars) return;

  const statusOf = (stock) => (stock === 0 ? 'out' : stock < LOW_STOCK_THRESHOLD ? 'low' : 'ok');

  const allCats = [...jointCats, ...cookieCats];
  const alerts = allCats
    .map((c) => {
      const stock = inventory[c.id] || 0;
      const status = statusOf(stock);
      if (status === 'ok') return null;
      return {
        label: categoryLabel(c, { shortCookie: isCookieCategoryId(c.id) }),
        color: c.color,
        stock,
        status,
        catId: c.id,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) || a.stock - b.stock);

  const alertHtml =
    !stockPending && alerts.length
      ? `<div class="stock-alerts" role="status">
        <div class="stock-alerts-kicker">${alerts.length} need attention</div>
        <div class="stock-alert-chips">
          ${alerts
            .map(
              (a) => `
            <div class="stock-alert-chip is-${a.status}" data-status="${a.status}">
              <span class="stock-alert-swatch" style="background:${a.color}"></span>
              <span class="stock-alert-name">${escapeHtml(a.label)}</span>
              <span class="stock-alert-qty">${a.status === 'out' ? 'Out' : a.stock}</span>
            </div>`,
            )
            .join('')}
        </div>
      </div>`
      : !stockPending
        ? `<div class="stock-alerts is-clear"><span class="stock-alerts-kicker">All flavors healthy</span></div>`
        : '';

  const capRowsHtml = (cats, capacity, { shortCookie = false } = {}) =>
    cats
      .map((c) => {
        const stock = inventory[c.id] || 0;
        const status = statusOf(stock);
        const pct = stockPending ? 0 : Math.min(100, Math.round((stock / capacity) * 100));
        const reorderPct = Math.min(100, Math.round((LOW_STOCK_THRESHOLD / capacity) * 100));
        return `
        <div class="stock-cap-row" data-status="${status}">
          <div class="stock-cap-label">
            <span class="hbar-swatch" style="background:${c.color}"></span>
            <span class="hbar-name">${escapeHtml(categoryLabel(c, { shortCookie }))}</span>
          </div>
          <div class="stock-cap-track" title="Reorder under ${LOW_STOCK_THRESHOLD}">
            <div class="stock-cap-fill is-${status}" style="width:${pct}%;background:${c.color}"></div>
            <span class="stock-cap-mark" style="left:${reorderPct}%" aria-hidden="true"></span>
          </div>
          <div class="stock-cap-val${stockPending ? ' is-pending' : status === 'ok' ? '' : ` is-${status}`}">${stockPending ? '··' : stock}</div>
        </div>`;
      })
      .join('');

  stockBars.innerHTML = stockPending
    ? insightSplitHtml(
        insightGroupHtml('Joints', rankRowPlaceholders(5, { swatch: true, meta: false })),
        insightGroupHtml('Cookies', rankRowPlaceholders(4, { swatch: true, meta: false })),
      )
    : `${alertHtml}
      ${insightSplitHtml(
        insightGroupHtml('Joints', capRowsHtml(jointCats, JOINT_STOCK_CAPACITY)),
        insightGroupHtml(
          'Cookies',
          capRowsHtml(cookieCats, COOKIE_STOCK_CAPACITY, { shortCookie: true }),
        ),
      )}`;

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
    Object.entries(normalizeInventoryBreakdown(item.breakdown)).forEach(([id, qty]) => {
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

function syncEditModalMode() {
  const body = document.getElementById('editModalBody');
  if (!body) return;
  // Match order-modal shell: pick/config need flex + inner scroll; main uses whole-sheet scroll.
  if (editSaleMode === 'pick' || editSaleMode === 'config') {
    body.dataset.mode = editSaleMode;
  } else {
    delete body.dataset.mode;
  }
}

function renderEditSaleModal() {
  syncEditModalMode();
  if (editSaleMode === 'pick') renderEditSalePickView();
  else if (editSaleMode === 'config') renderEditSaleConfigView();
  else renderEditSaleMainView();
}

function renderEditSaleMainView() {
  const body = document.getElementById('editModalBody');
  if (!body) return;

  const sale = salesCache.find((s) => s.id === editingSaleId);
  const time = sale
    ? new Date(sale.created_at).toLocaleString(undefined, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    : '';
  const total = saleItemsTotal(editSaleItems);

  const fulfillBits = [];
  if (sale) {
    const phone = String(sale.client_phone || '').trim();
    if (phone) fulfillBits.push(phone);
    const delivery = sale.delivery && typeof sale.delivery === 'object' ? sale.delivery : {};
    const when = String(delivery.label || '').trim();
    if (sale.delivery_enabled === false) {
      fulfillBits.push(when ? `Pickup · ${when}` : 'Pickup');
    } else if (when) {
      fulfillBits.push(`Delivery · ${when}`);
    }
    const location = String(sale.location_label || '').trim();
    if (location) fulfillBits.push(location);
    const fee = sale.delivery_fee_ugx;
    if (fee != null && !Number.isNaN(Number(fee)) && Number(fee) > 0) {
      fulfillBits.push(`Fee ${fmtUGX(fee)}`);
    }
  }
  const fulfillHtml = fulfillBits.length
    ? `<div class="edit-sale-fulfillment">${escapeHtml(fulfillBits.join(' · '))}</div>`
    : '';

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
    ${fulfillHtml}
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
        applyToCartLines(editSaleItems);
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
  const otherLines = editSaleItems
    .filter((_, i) => i !== editingSaleItemIdx)
    .map((item) => ({
      productId: item.product_id,
      breakdown: item.breakdown,
      isReward: item.is_reward,
      quantity: item.quantity,
    }));
  body.innerHTML = renderProductConfigView(
    editConfigProduct,
    editConfigSelection,
    draftStock,
    editingSaleItemIdx !== null,
    { otherLines },
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

  const otherLines = editSaleItems
    .filter((_, i) => i !== editingSaleItemIdx)
    .map((item) => ({
      productId: item.product_id,
      breakdown: item.breakdown,
      isReward: item.is_reward,
      quantity: item.quantity,
    }));
  const { breakdown, lineTotal, detail } = buildLineFromConfig(product, editConfigSelection, {
    otherLines,
  });
  const saleItem = {
    product_id: product.id,
    product_name: cookieLineDisplayName(product.id, breakdown, product.name),
    detail,
    line_total: lineTotal,
    breakdown,
  };

  if (editingSaleItemIdx !== null) {
    editSaleItems[editingSaleItemIdx] = saleItem;
  } else {
    editSaleItems.push(saleItem);
  }
  applyToCartLines(editSaleItems);

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
  const { applyStockDeltaToServer, awaitInventoryReady } = await import('./inventory.js');
  await awaitInventoryReady();
  const allIds = new Set([...Object.keys(oldBreakdown), ...Object.keys(newBreakdown)]);
  for (const id of allIds) {
    const oldQty = oldBreakdown[id] || 0;
    const newQty = newBreakdown[id] || 0;
    const delta = newQty - oldQty;
    if (delta === 0) continue;
    if (!Object.hasOwn(inventory, id)) continue;
    // Sale edit: +delta items sold means −delta stock on server.
    await applyStockDeltaToServer(id, -delta);
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

  const prevPaid = Math.max(0, Number(sale.amount_paid_ugx) || 0);
  let amountPaid = prevPaid;
  let creditCleared = editSaleIsCredit ? editSaleCreditCleared : true;
  let clearedAt =
    editSaleIsCredit && creditCleared ? sale.cleared_at || new Date().toISOString() : null;

  if (!editSaleIsCredit) {
    amountPaid = total;
    creditCleared = true;
    clearedAt = null;
  } else if (creditCleared) {
    amountPaid = Math.max(prevPaid, total);
  } else {
    // Unpaid credit: newly converting from cash/cleared must zero paid
    // (match checkout) so AR/clients see the balance. Keep prior paid only
    // when this sale was already open unpaid credit (partial payments).
    const wasOpenUnpaid = Boolean(sale.is_credit && !sale.credit_cleared);
    amountPaid = wasOpenUnpaid ? Math.min(prevPaid, total) : 0;
  }

  const payload = {
    items: editSaleItems,
    total_ugx: total,
    client_id: clientId,
    is_credit: editSaleIsCredit,
    credit_cleared: creditCleared,
    cleared_at: clearedAt,
    amount_paid_ugx: amountPaid,
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
    try {
      await refreshAfterSaleEdit();
    } catch (refreshErr) {
      console.error('refresh after void failed', refreshErr);
    }
    showToast('Could not void order', true);
  }
}
