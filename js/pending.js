const PENDING_KEYS = ['sales', 'inventory', 'clients', 'deliveries'];

const ICON_ROUTE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"></circle><circle cx="18" cy="18" r="2.4"></circle><path d="M6 8.4v4.2a3.4 3.4 0 0 0 3.4 3.4h5.2"></path></svg>`;

const CHART_RANGE_SHORT = ['7D', '14D', '30D', '90D', 'All'];

export function applyPendingFlags(cached = {}) {
  document.body.classList.toggle('pending-sales', !cached.sales);
  document.body.classList.toggle('pending-inventory', !cached.inventory);
  document.body.classList.toggle('pending-clients', !cached.clients);
  document.body.classList.toggle('pending-deliveries', !cached.deliveries);
  document.body.classList.toggle('pending-today-stats', !cached.sales);
  document.body.classList.toggle('pending-stock-glance', !cached.inventory);
}

export function clearPendingFlags() {
  PENDING_KEYS.forEach((key) => document.body.classList.remove(`pending-${key}`));
  document.body.classList.remove('pending-today-stats', 'pending-stock-glance');
}

export function isDataPending(key) {
  return document.body.classList.contains(`pending-${key}`);
}

/** True when a dataset is still fetching and has nothing to show yet. */
export function showPlaceholder(key, count = 0) {
  return isDataPending(key) && count === 0;
}

function pt(wide = false) {
  return wide ? '········' : '···';
}

export function clientRowPlaceholders(count = 5) {
  return Array.from(
    { length: count },
    () => `
    <div class="client-row client-row--placeholder" aria-hidden="true">
      <span class="cl-name is-pending">${pt(true)}</span>
      <span class="cl-date is-pending">${pt()}</span>
    </div>`,
  ).join('');
}

export function barRowPlaceholders(count = 4, wideLabel = false) {
  return Array.from(
    { length: count },
    () => `
    <div class="bar-row bar-row--placeholder" aria-hidden="true">
      <div class="bar-label${wideLabel ? ' wide' : ''} is-pending">${pt(wideLabel)}</div>
      <div class="bar-track"><div class="bar-fill is-pending" style="width:35%"></div></div>
      <div class="bar-value is-pending">${pt()}</div>
    </div>`,
  ).join('');
}

export function fixedItemPlaceholders(count = 3) {
  return Array.from(
    { length: count },
    (_, i) => `
    <div class="fixed-item fixed-item--placeholder" aria-hidden="true">
      <span class="is-pending">${i + 1}. ${pt(true)}</span>
      <span class="is-pending">${pt()}</span>
    </div>`,
  ).join('');
}

export function receiptOrderPlaceholders(count = 3) {
  return Array.from(
    { length: count },
    () => `
    <div class="receipt-order receipt-order--placeholder" aria-hidden="true">
      <div class="r-head">
        <span class="r-time is-pending">${pt()}</span>
        <span class="r-amt is-pending">${pt()}</span>
      </div>
      <div class="r-items is-pending">${pt(true)}</div>
    </div>`,
  ).join('');
}

export function receiptListPlaceholder() {
  return `
    <div class="order-day-group order-day-group--placeholder" aria-hidden="true">
      <button class="order-day-header expanded" type="button" tabindex="-1" disabled>
        <span class="day-label is-pending">${pt()}</span>
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="day-meta is-pending">${pt()}</span>
          <span class="day-caret">▸</span>
        </span>
      </button>
      <div class="order-day-body">
        ${receiptOrderPlaceholders(3)}
      </div>
    </div>`;
}

export function deliveryTripPlaceholders(count = 3) {
  return Array.from(
    { length: count },
    () => `
    <div class="delivery-trip delivery-trip--placeholder" aria-hidden="true">
      <div class="delivery-trip-route" aria-hidden="true">
        <span class="delivery-trip-dot pickup"></span>
        <span class="delivery-trip-line"></span>
        <span class="delivery-trip-dot dropoff"></span>
      </div>
      <div class="delivery-trip-body">
        <div class="delivery-trip-top">
          <span class="delivery-trip-who is-pending">${pt(true)}</span>
          <span class="delivery-trip-fee is-pending">${pt()}</span>
        </div>
        <div class="delivery-trip-meta is-pending">${pt(true)}</div>
        <div class="delivery-trip-addresses">
          <span class="delivery-trip-addr pickup is-pending">${pt(true)}</span>
          <span class="delivery-trip-addr dropoff is-pending">${pt(true)}</span>
        </div>
      </div>
    </div>`,
  ).join('');
}

export function deliveryLogPlaceholder() {
  return `
    <div class="delivery-day-group delivery-day-group--placeholder" aria-hidden="true">
      <button class="delivery-day-header expanded" type="button" tabindex="-1" disabled>
        <span class="is-pending">${pt()}</span>
      </button>
      <div class="delivery-day-body">
        ${deliveryTripPlaceholders(3)}
      </div>
    </div>`;
}

export function deliveryModelPlaceholder() {
  return `
    <div class="dl-model-card empty">
      <div class="dl-model-icon" aria-hidden="true">${ICON_ROUTE}</div>
      <div class="dl-model-title">Decode SafeBoda pricing</div>
      <div class="dl-model-copy">Log real SafeBoda quotes at checkout — pickup, drop-off, distance, and the fee they charged. Venus fits a formula so you can predict costs before ordering.</div>
      <div class="dl-formula-preview is-pending">Predicted fee ≈ base + (km × per-km rate)</div>
    </div>`;
}

export function analyticsOverviewPlaceholder() {
  return `
    <div class="ao-hero">
      <div class="ao-hero-head">
        <span class="ao-eyebrow">Today</span>
        <span class="ao-delta neutral is-pending">${pt()}</span>
      </div>
      <div class="ao-hero-value is-pending">${pt(true)}</div>
      <div class="ao-hero-sub is-pending">${pt(true)}</div>
    </div>

    <div class="ao-tiles">
      <div class="ao-tile">
        <div class="ao-tile-top">
          <span class="ao-tile-label">This month</span>
          <span class="ao-tile-pill is-pending">${pt()}</span>
        </div>
        <div class="ao-tile-value is-pending">${pt()}</div>
        <div class="ao-tile-track"><div class="ao-tile-fill is-pending" style="width:40%"></div></div>
      </div>
      <div class="ao-tile">
        <div class="ao-tile-top">
          <span class="ao-tile-label">All orders</span>
          <span class="ao-tile-pill is-pending">${pt()}</span>
        </div>
        <div class="ao-tile-value is-pending">${pt()}</div>
        <div class="ao-tile-foot is-pending">${pt(true)}</div>
      </div>
    </div>

    <div class="ao-feature">
      <div class="ao-feature-badge" aria-hidden="true">★</div>
      <div class="ao-feature-body">
        <div class="ao-feature-kicker">Customer favorite</div>
        <div class="ao-feature-title is-pending">${pt(true)}</div>
        <div class="ao-feature-sub is-pending">${pt(true)}</div>
      </div>
    </div>

    <div class="credit-panel settled">
      <div class="credit-panel-head">
        <div class="credit-panel-icon ok" aria-hidden="true">✓</div>
        <div class="credit-panel-copy">
          <div class="credit-panel-title is-pending">${pt()}</div>
          <div class="credit-panel-sub is-pending">${pt(true)}</div>
        </div>
      </div>
    </div>`;
}

export function revenueChartPlaceholder() {
  const pills = CHART_RANGE_SHORT.map(
    (short, i) =>
      `<button type="button" class="rev-range-btn${i === 0 ? ' active' : ''}" tabindex="-1" disabled>${short}</button>`,
  ).join('');

  return `
    <div class="rev-chart-card rev-chart-card--placeholder" aria-hidden="true">
      <div class="rev-chart-head">
        <div>
          <div class="rev-chart-title">Revenue</div>
          <div class="rev-chart-sub is-pending">${pt(true)}</div>
        </div>
        <div class="rev-range-pills" role="group" aria-label="Chart time range">${pills}</div>
      </div>
      <div class="rev-stats">
        <div class="rev-stat"><span class="rev-stat-val is-pending">${pt()}</span><span class="rev-stat-lbl">Total</span></div>
        <div class="rev-stat"><span class="rev-stat-val is-pending">${pt()}</span><span class="rev-stat-lbl">Avg / period</span></div>
        <div class="rev-stat"><span class="rev-stat-val is-pending">${pt()}</span><span class="rev-stat-lbl">Orders</span></div>
        <div class="rev-stat"><span class="rev-stat-val is-pending">${pt()}</span><span class="rev-stat-lbl">Peak</span></div>
      </div>
      <div class="rev-chart-wrap">
        <div class="rev-chart-area-pending is-pending" aria-hidden="true"></div>
      </div>
    </div>`;
}

export function salesPatternsPlaceholder() {
  const barCols = Array.from(
    { length: 12 },
    () => `
    <div class="pattern-bar-col" aria-hidden="true">
      <div class="pattern-bar-track"><div class="pattern-bar-fill hour is-pending" style="height:28%"></div></div>
      <span class="pattern-bar-lbl"></span>
    </div>`,
  ).join('');

  return `
    <div class="pattern-grid pattern-grid--placeholder" aria-hidden="true">
      <div class="pattern-card">
        <div class="pattern-card-head">
          <span class="pattern-title">Peak hours</span>
          <span class="pattern-hint is-pending">${pt()}</span>
        </div>
        <div class="pattern-bars vertical">${barCols}</div>
      </div>
      <div class="pattern-card">
        <div class="pattern-card-head">
          <span class="pattern-title">By weekday</span>
          <span class="pattern-hint is-pending">${pt()}</span>
        </div>
        <div class="pattern-bars vertical">${barCols}</div>
      </div>
      <div class="pattern-card pattern-mix">
        <div class="pattern-card-head">
          <span class="pattern-title">Payment mix</span>
          <span class="pattern-hint is-pending">${pt()}</span>
        </div>
        <div class="mix-bar"><div class="mix-paid is-pending" style="width:62%"></div><div class="mix-credit is-pending" style="width:38%"></div></div>
        <div class="mix-legend">
          <span class="is-pending">${pt(true)}</span>
          <span class="is-pending">${pt(true)}</span>
        </div>
      </div>
    </div>`;
}

export function stockStatusPlaceholder() {
  return `
    <div class="ds-group ds-joints">
      <div class="ds-group-label">Joints</div>
      <div class="ds-group-stats">
        <span class="ds-ok is-pending">${pt()}</span>
        <span class="ds-sep">·</span>
        <span class="ds-low is-pending">${pt()}</span>
        <span class="ds-sep">·</span>
        <span class="ds-out is-pending">${pt()}</span>
      </div>
    </div>`;
}
