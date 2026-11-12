import { getNavPages, getAssetHref, getPageHref } from './config.js';

const ACTION_ICONS = {
  admin:
    '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  debug:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  signOut:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};

function iconSvg(paths) {
  return `<svg class="fab-menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** Nav key for the current view: the Admin page's Users view has its own menu item. */
function navKey(currentPage) {
  if (currentPage === 'admin' && /^#users$/i.test(location.hash || '')) return 'users';
  return currentPage;
}

function navAttrs(page) {
  const target = page.target || page.id;
  return `href="${getPageHref(target, page.hash || '')}" data-spa-page="${target}" data-nav-key="${page.id}"`;
}

function navLink(page, currentPage) {
  const active = page.id === navKey(currentPage) ? ' active' : '';
  const on = active ? ' on' : '';
  return `<a class="tab-btn rail-chip${active}${on}" ${navAttrs(page)} aria-current="${active ? 'page' : 'false'}">${page.label}</a>`;
}

function fabMenuActionItems(currentPage, isAdmin) {
  const items = [];
  if (isAdmin) {
    const adminOn = navKey(currentPage) === 'admin';
    items.push(`<a class="fab-menu-item fab-menu-item--action${adminOn ? ' is-active' : ''}" id="adminBtn" href="${getPageHref('admin', '#overview')}" data-spa-page="admin" data-nav-key="admin" aria-label="Admin" title="Admin" aria-current="${adminOn ? 'page' : 'false'}">
      ${iconSvg(ACTION_ICONS.admin)}
      <span class="fab-menu-item-label">Admin</span>
    </a>`);
    items.push(`<button class="fab-menu-item fab-menu-item--action" id="debugBtn" aria-label="Debug log" title="Debug log" type="button">
      ${iconSvg(ACTION_ICONS.debug)}
      <span class="fab-menu-item-label">Debug</span>
      <span class="fab-badge" id="debugBadge" style="display:none;">0</span>
    </button>`);
  }
  items.push(`<a class="fab-menu-item fab-menu-item--action" id="changePasswordBtn" href="${getAssetHref('').replace(/assets\/?$/, '')}auth.html?change=1" aria-label="Change password" title="Change password">
    ${iconSvg(ACTION_ICONS.signOut)}
    <span class="fab-menu-item-label">Change password</span>
  </a>`);
  items.push(`<button class="fab-menu-item fab-menu-item--action fab-menu-item--danger" id="signOutBtn" aria-label="Sign out" title="Sign out" type="button">
    ${iconSvg(ACTION_ICONS.signOut)}
    <span class="fab-menu-item-label">Sign out</span>
  </button>`);
  return items.join('');
}

export function renderShell(currentPage) {
  const pages = getNavPages();
  const navTabs = pages.map((p) => navLink(p, currentPage)).join('');
  const isAdmin = window.VenusPosAuth?.isAdmin?.() === true;
  const roleLabel = isAdmin ? 'Admin' : 'Staff';
  const fabActionItems = fabMenuActionItems(currentPage, isAdmin);

  return `
    <a class="skip-link" href="#page-content">Skip to content</a>
    <header class="header">
      <div class="header-top">
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
          <nav class="fab-menu" id="floatingNav" aria-label="Account menu" aria-hidden="true" hidden>
            ${fabActionItems}
          </nav>
        </div>
      </div>
      </div>
      <nav class="tabs rail header-nav" aria-label="Main navigation">
        <div class="rail-track" id="headerNav">
          ${navTabs}
        </div>
      </nav>
    </header>
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

    <div class="modal-overlay amount-modal" id="amountModal" hidden>
      <div class="modal amount-modal__panel">
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
      // Stop order alerts on this device for the signed-out user (needs the session, so first).
      const { syncWebPushPrefs } = await import('./notifications.js');
      await Promise.race([
        syncWebPushPrefs({ unsubscribe: true }),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
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
  const key = navKey(currentPage);

  document.querySelectorAll('.tabs .tab-btn').forEach((el) => {
    const id = el.getAttribute('data-nav-key') || el.getAttribute('data-spa-page');
    const active = id === key;
    el.classList.toggle('active', active);
    el.classList.toggle('on', active);
    el.setAttribute('aria-current', active ? 'page' : 'false');
  });

  document.querySelectorAll('.fab-menu-item[data-spa-page]').forEach((el) => {
    const id = el.getAttribute('data-nav-key') || el.getAttribute('data-spa-page');
    const active = id === key;
    el.classList.toggle('is-active', active);
    el.setAttribute('aria-current', active ? 'page' : 'false');
  });

  scrollActiveTabIntoView();
}

/** Centre the active chip in the header rail (horizontal only — never moves the page). */
export function scrollActiveTabIntoView({ smooth = true } = {}) {
  const nav = document.getElementById('headerNav');
  if (!nav) return;
  const run = () => {
    const active = nav.querySelector('.tab-btn.active');
    if (active) {
      const navRect = nav.getBoundingClientRect();
      const tabRect = active.getBoundingClientRect();
      const offset = tabRect.left - navRect.left + nav.scrollLeft;
      const target = offset - (nav.clientWidth - tabRect.width) / 2;
      const max = nav.scrollWidth - nav.clientWidth;
      const left = Math.max(0, Math.min(max, target));
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (typeof nav.scrollTo === 'function') {
        nav.scrollTo({ left, behavior: smooth && !reduce ? 'smooth' : 'auto' });
      } else {
        nav.scrollLeft = left;
      }
    }
  };
  window.requestAnimationFrame(run);
}

function wireHeaderNav() {
  const nav = document.getElementById('headerNav');
  if (!nav) return;
  window.addEventListener('hashchange', () => scrollActiveTabIntoView());
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => scrollActiveTabIntoView({ smooth: false })).catch(() => {});
  }
  scrollActiveTabIntoView({ smooth: false });
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
  wireHeaderNav();
}
