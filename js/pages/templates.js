/** Static page markup — kept out of the document when inactive (keep-alive). */

export const PAGE_TEMPLATES = {
  home: `
    <div class="dashboard">
      <div class="kpi-grid">
        <button class="kpi-card kpi-revenue" id="todayRevenueStat" type="button">
          <div class="val is-pending" id="todayRevenue">UGX —</div>
          <div class="lbl">Today's revenue</div>
        </button>
        <button class="kpi-card kpi-units" id="todayUnitsStat" type="button">
          <div class="sold-row">
            <div class="sold-item">
              <div class="val is-pending" id="todayJoints">—</div>
              <div class="sold-sub">joints</div>
            </div>
            <div class="sold-sep"></div>
            <div class="sold-item">
              <div class="val is-pending" id="todayCookies">—</div>
              <div class="sold-sub">cookies</div>
            </div>
          </div>
        </button>
      </div>

      <div class="stock-card stock-summary" id="stockGlance" tabindex="0" aria-label="View inventory">
        <div class="sg-joints">
          <div class="donut-container mini">
            <div class="donut" id="donutJoints"></div>
            <div class="donut-hole">
              <div class="donut-total is-pending" id="donutJointsTotal">—</div>
              <div class="donut-caption">joints</div>
            </div>
          </div>
          <div class="sg-pills" id="jointsStatus" aria-label="Joint stock status"></div>
        </div>
        <div class="sg-divider" aria-hidden="true"></div>
        <div class="sg-cookies">
          <div class="sg-cookies-label">Cookies</div>
          <div class="sg-cookie-list" id="cookieFlavorGlance"></div>
        </div>
      </div>

      <div class="section-head">
        <h2>Checkout</h2>
        <span class="section-hint">Tap a product to sell</span>
      </div>
      <div class="product-list" id="productList">
        <button class="product-row" type="button" data-product="scout">
          <div>
            <div class="pname">Scout Pack</div>
            <div class="pcount">1 joint</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 8,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="pilot">
          <div>
            <div class="pname">Pilot Pack</div>
            <div class="pcount">2 joints</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 15,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="commander">
          <div>
            <div class="pname">Commander's Stash</div>
            <div class="pcount">5 joints</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 35,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="variety">
          <div>
            <div class="pname">Variety Pack</div>
            <div class="pcount">8 joints</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 50,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="cookie_duet">
          <div>
            <div class="pname">Cookie Duet</div>
            <div class="pcount">2 cookies</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 15,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="cookie_trio">
          <div>
            <div class="pname">Cookie Trio</div>
            <div class="pcount">3 cookies</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 21,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="cookie_quartet">
          <div>
            <div class="pname">Cookie Quartet</div>
            <div class="pcount">4 cookies</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 25,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="plain_single">
          <div>
            <div class="pname">Plain</div>
            <div class="pcount">per joint</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 5,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="spliff_single">
          <div>
            <div class="pname">Bangis</div>
            <div class="pcount">per joint</div>
          </div>
          <div class="p-right">
            <div class="pprice">UGX 5,000</div>
          </div>
        </button>
        <button class="product-row" type="button" data-product="cookie_single">
          <div>
            <div class="pname">Cookies</div>
            <div class="pcount">per cookie</div>
          </div>
          <div class="p-right">
            <div class="pprice">from UGX 5,000</div>
          </div>
        </button>
      </div>
    </div>
  `,

  inventory: `
    <p class="page-hint">Tap +/− to adjust stock · double-tap for bulk · tap count to edit directly</p>
    <div class="grid" id="invGrid"></div>
  `,

  clients: `
    <div class="client-add-row">
      <input type="text" id="newClientInput" class="client-input" placeholder="New client name…" autocomplete="name" />
      <button class="modal-btn confirm" id="addClientBtn" style="flex:0 0 auto; padding: 0 20px;" type="button">Add</button>
    </div>
    <div class="client-search-wrap">
      <input type="search" id="clientSearchInput" class="client-input" placeholder="Search clients…" autocomplete="off" enterkeyhint="search" />
      <button class="client-search-clear" id="clientSearchClear" type="button" hidden aria-label="Clear search">✕</button>
    </div>
    <div class="client-list-meta" id="clientListMeta"></div>
    <div class="client-list" id="clientList"></div>
  `,

  reviews: `
    <div class="reviews-page">
      <header class="reviews-hero" id="reviewsHero"></header>
      <div class="reviews-list" id="reviewsList"></div>
    </div>
  `,

  delivery: `
    <div class="delivery-dashboard">
      <div id="deliveryModel"></div>
      <div id="deliveryTestBench"></div>
      <div class="section-title">Logged quotes</div>
      <div id="deliveryLogList"></div>
    </div>
  `,

  history: `
    <div class="history-page">
      <header class="history-hero" id="orderHistoryHero"></header>
      <div id="orderHistoryList" class="history-timeline"></div>
    </div>
  `,

  analytics: `
    <div class="analytics-overview" id="statCards"></div>
    <div class="section-title">Cookie partner</div>
    <div class="analytics-block" id="cookiePartnerPanel"></div>
    <div class="analytics-block" id="revenueChart"></div>
    <div class="section-title">Sales patterns</div>
    <div id="salesPatterns"></div>
    <div class="section-title" id="stockLevelsLabel">Stock levels</div>
    <div id="stockBars"></div>
    <div class="section-title-row">
      <div class="section-title" id="productRevenueLabel">Revenue by product</div>
      <div class="insight-period-pills" id="productRevenuePeriod" role="group" aria-label="Revenue by product period"></div>
    </div>
    <div id="productRevenue"></div>
    <div class="section-title-row">
      <div class="section-title" id="topClientsLabel">Top clients</div>
      <div class="insight-period-pills" id="topClientsPeriod" role="group" aria-label="Top clients period"></div>
    </div>
    <div id="topClients"></div>
  `,

  admin: `
    <p class="page-hint">Storefront accounts, pickup &amp; delivery hours, and maintenance</p>
    <div class="admin-page">
      <div class="admin-tabs" role="tablist" aria-label="Admin sections">
        <button type="button" class="admin-tab is-active" data-admin-tab="overview" role="tab" aria-selected="true">Overview</button>
        <button type="button" class="admin-tab" data-admin-tab="users" role="tab" aria-selected="false">Users</button>
        <button type="button" class="admin-tab" data-admin-tab="clients" role="tab" aria-selected="false">Clients</button>
        <button type="button" class="admin-tab" data-admin-tab="hours" role="tab" aria-selected="false">Hours</button>
        <button type="button" class="admin-tab" data-admin-tab="tools" role="tab" aria-selected="false">Tools</button>
      </div>
      <div class="admin-body" id="adminBody"></div>
    </div>
  `,
};

export const PAGE_TITLES = {
  home: 'Venus POS',
  inventory: 'Inventory · Venus POS',
  clients: 'Clients · Venus POS',
  reviews: 'Reviews · Venus POS',
  delivery: 'Delivery · Venus POS',
  history: 'History · Venus POS',
  analytics: 'Analytics · Venus POS',
  admin: 'Admin · Venus POS',
};
