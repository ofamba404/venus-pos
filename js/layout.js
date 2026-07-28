import { getNavPages, getAssetHref, getPageHref } from './config.js';

const PAGE_ICONS = {
  home: '<path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-7H10v7H5a1 1 0 0 1-1-1V10.5z"/>',
  inventory: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clients: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5"/>',
  reviews: '<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9 7.2 17.9l.9-5.4L4.2 8.7l5.4-.8L12 3z"/>',
  delivery:
    '<circle cx="19.5" cy="16.5" r="2.5"/><circle cx="4.5" cy="16.5" r="2.5"/><path d="M20.235 7.87c1.281 1.559 1.727 3.042 1.764 3.826a5.3 5.3 0 0 0-2.217-.479c-2.445 0-4.64 1.626-5.164 3.792c-.126.518-.188.777-.324.884s-.356.107-.795.107h-2.878c-.443 0-.664 0-.8-.108c-.137-.11-.197-.367-.316-.883c-.496-2.138-2.508-3.997-4.603-3.84c-.211.017-.317.025-.39.008c-.071-.016-.144-.057-.29-.14c-.421-.237-.851-.463-1.264-.714A2 2 0 0 1 2 8.683c-.013-.384.207-.764.652-.66l6.42 1.511c.483.114.724.17.931.132s.462-.212.97-.56c1.288-.88 3.33-1.713 5.365-.978c.557.201.836.302.994.307c.16.005.392-.063.857-.198a9.5 9.5 0 0 1 2.045-.367m0 0c-.802-.978-1.934-1.985-3.5-2.87"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  analytics: '<path d="M5 19V11"/><path d="M12 19V5"/><path d="M19 19v-8"/>',
};

const ACTION_ICONS = {
  admin:
    '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  debug:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  signOut:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};

/** Closest to the toggle first: day-to-day work → oversight → system → leave. */
const FAB_NAV_ORDER = ['home', 'inventory', 'clients', 'delivery', 'history', 'analytics', 'reviews'];

function iconSvg(paths) {
  return `<svg class="fab-menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function navLink(page, currentPage) {
  const active = page.id === currentPage ? ' active' : '';
  return `<a class="tab-btn${active}" href="${getPageHref(page.id)}" data-spa-page="${page.id}" aria-current="${active ? 'page' : 'false'}">${page.label}</a>`;
}

function fabMenuNavItem(page, currentPage) {
  const active = page.id === currentPage;
  return `<a class="fab-menu-item fab-menu-item--nav${active ? ' is-active' : ''}" href="${getPageHref(page.id)}" data-spa-page="${page.id}" aria-label="${page.label}" aria-current="${active ? 'page' : 'false'}">
    ${iconSvg(PAGE_ICONS[page.id] || '')}
    <span class="fab-menu-item-label">${page.label}</span>
  </a>`;
}

function sortFabNavPages(pages) {
  const rank = new Map(FAB_NAV_ORDER.map((id, i) => [id, i]));
  return [...pages].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}

function fabMenuActionItems(currentPage, isAdmin) {
  const items = [];
  if (isAdmin) {
    items.push(`<a class="fab-menu-item fab-menu-item--action${currentPage === 'admin' ? ' is-active' : ''}" id="adminBtn" href="${getPageHref('admin')}" data-spa-page="admin" aria-label="Admin" title="Admin" aria-current="${currentPage === 'admin' ? 'page' : 'false'}">
      ${iconSvg(ACTION_ICONS.admin)}
      <span class="fab-menu-item-label">Admin</span>
    </a>`);
    items.push(`<button class="fab-menu-item fab-menu-item--action" id="debugBtn" aria-label="Debug log" title="Debug log" type="button">
      ${iconSvg(ACTION_ICONS.debug)}
      <span class="fab-menu-item-label">Debug</span>
      <span class="fab-badge" id="debugBadge" style="display:none;">0</span>
    </button>`);
  }
  items.push(`<button class="fab-menu-item fab-menu-item--action fab-menu-item--danger" id="signOutBtn" aria-label="Sign out" title="Sign out" type="button">
    ${iconSvg(ACTION_ICONS.signOut)}
    <span class="fab-menu-item-label">Sign out</span>
  </button>`);
  return items.join('');
}

export function renderShell(currentPage) {
  const pages = getNavPages();
  const desktopTabs = pages.map((p) => navLink(p, currentPage)).join('');
  const isAdmin = window.VenusPosAuth?.isAdmin?.() === true;
  const roleLabel = isAdmin ? 'Admin' : 'Staff';
  const fabNavItems = sortFabNavPages(pages)
    .map((p) => fabMenuNavItem(p, currentPage))
    .join('');
  const fabActionItems = fabMenuActionItems(currentPage, isAdmin);

  return `
    <a class="skip-link" href="#page-content">Skip to content</a>
    <div class="header">
      <div class="header-left">
        <a class="brand-logo" href="${getPageHref('home')}" data-spa-page="home" aria-label="Venus POS home">
          <img src="${getAssetHref('logo.svg')}" alt="" width="40" height="40" decoding="async" />
        </a>
        <div>
          <h1>POS</h1>
          <div class="sub">${roleLabel} · Inventory &amp; register</div>
        </div>
      </div>
      <div class="header-actions">
        <div class="header-fab" id="headerFab">
          <button class="fab fab-nav" id="fabNavToggle" aria-label="Open menu" aria-expanded="false" aria-controls="floatingNav" type="button">
            <svg class="fab-nav-icon fab-nav-icon--menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16"/>
            </svg>
            <svg class="fab-nav-icon fab-nav-icon--close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18"/>
            </svg>
          </button>
          <nav class="fab-menu" id="floatingNav" aria-label="App menu" aria-hidden="true" hidden>
            ${fabNavItems}
            ${fabActionItems}
          </nav>
        </div>
      </div>
    </div>

    <nav class="tabs" aria-label="Main navigation">
      ${desktopTabs}
    </nav>
  `;
}

export function renderModals(currentPage = 'home') {
  return `
    <div class="bottom-dock" id="bottomDock">
      <div class="fab-stack" id="fabStack">
        <button class="fab fab-review" id="fabReviewOrders" aria-label="Review storefront orders" type="button" hidden>
          <svg class="fab-review-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 4h10a2 2 0 0 1 2 2v14l-3.5-2-3.5 2-3.5-2L5 20V6a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M9 9h6M9 13h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="fab-badge" id="fabBadge" style="display:none;">0</span>
        </button>
        <button class="fab" id="fabNewOrder" aria-label="New order" type="button">
          <svg class="fab-cart-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path class="fab-cart-body" d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.58L23 6H6"/>
            <circle class="fab-cart-wheel" cx="8" cy="21" r="1.5"/>
            <circle class="fab-cart-wheel" cx="19" cy="21" r="1.5"/>
          </svg>
          <span class="fab-badge" id="fabCartBadge" style="display:none;">0</span>
        </button>
      </div>
    </div>

    <div class="modal-overlay" id="orderModal" hidden>
      <div class="modal" id="orderModalBody" role="dialog" aria-modal="true" aria-labelledby="orderModalTitle"></div>
    </div>

    <div class="modal-overlay" id="confirmOverlay" hidden>
      <div class="modal">
        <div class="modal-title" id="confirmMessage">Are you sure?</div>
        <div class="modal-btns">
          <button id="confirmCancelBtn" class="modal-btn cancel" type="button">Cancel</button>
          <button id="confirmOkBtn" class="modal-btn confirm" type="button">Confirm</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="debugOverlay" hidden>
      <div class="modal">
        <div class="modal-title">Debug log</div>
        <p class="debug-note">Errors and warnings are captured here for on-device troubleshooting.</p>
        <textarea id="debugLogText" class="debug-log-text" readonly rows="12" placeholder="No errors logged yet."></textarea>
        <div class="modal-btns">
          <button id="debugSyncBtn" class="modal-btn confirm" type="button">Reload from server</button>
          <button id="debugClearBtn" class="modal-btn cancel" type="button">Clear</button>
          <button id="debugCopyBtn" class="modal-btn confirm" type="button">Copy log</button>
        </div>
        <button id="debugCloseBtn" class="modal-btn cancel" style="width:100%; margin-top:8px;" type="button">Close</button>
      </div>
    </div>

    <div class="modal-overlay" id="amountModal" hidden>
      <div class="modal">
        <div class="modal-title" id="amountModalTitle">Add amount</div>
        <input type="text" inputmode="numeric" pattern="[0-9]*" id="amountInput" class="qty-input" placeholder="0" autocomplete="off" style="margin-top:12px;" />
        <div class="modal-btns">
          <button id="amountCancel" class="modal-btn cancel" type="button">Cancel</button>
          <button id="amountConfirm" class="modal-btn confirm" type="button">Apply</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="settleOverlay" hidden>
      <div class="modal settle-modal" id="settleModalBody" role="dialog" aria-modal="true" aria-labelledby="settleModalTitle"></div>
    </div>

    <div class="modal-overlay" id="editOverlay" hidden>
      <div class="modal" id="editModalBody" role="dialog" aria-modal="true" aria-labelledby="editModalTitle"></div>
    </div>

    <div class="toast" id="toast" role="status" aria-live="polite" data-tone="success" hidden>
      <span class="toast-icon" aria-hidden="true"></span>
      <span class="toast-msg" id="toastMsg"></span>
    </div>

    <div id="inAppBanner" class="in-app-banner" role="status" aria-live="polite" hidden></div>
  `;
}

function wireSignOut() {
  const btn = document.getElementById('signOutBtn');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { resetRealtimeClient } = await import('./realtime-client.js');
      resetRealtimeClient();
    } catch {
      /* ignore */
    }
    try {
      await window.VenusPosAuth?.signOut?.();
    } catch {
      /* still leave */
    }
    const href = window.VenusPosAuth?.authPageHref?.() || 'auth.html';
    window.location.replace(href);
  });
}

/** Update tab / FAB active states without remounting the shell. */
export function setActiveNav(currentPage) {
  document.body.dataset.page = currentPage;

  document.querySelectorAll('.tabs .tab-btn').forEach((el) => {
    const id = el.getAttribute('data-spa-page');
    const active = id === currentPage;
    el.classList.toggle('active', active);
    el.setAttribute('aria-current', active ? 'page' : 'false');
  });

  document.querySelectorAll('.fab-menu-item[data-spa-page]').forEach((el) => {
    const id = el.getAttribute('data-spa-page');
    const active = id === currentPage;
    el.classList.toggle('is-active', active);
    el.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

/**
 * Mount chrome once. Page bodies are injected by the view cache into #page-content.
 * Initial HTML inside #app-root is discarded — templates own page markup.
 */
export function mountShell(currentPage) {
  const root = document.getElementById('app-root');
  if (!root) return;
  if (root.dataset.shellMounted === '1') {
    setActiveNav(currentPage);
    return;
  }

  document.body.dataset.page = currentPage;
  root.innerHTML =
    renderShell(currentPage) +
    `<main id="page-content" class="page-view" tabindex="-1"></main>` +
    renderModals(currentPage);
  root.dataset.shellMounted = '1';
  wireSignOut();
}
