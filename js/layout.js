import { PAGES, getPageHref } from './config.js';

const PAGE_ICONS = {
  home: '<path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-7H10v7H5a1 1 0 0 1-1-1V10.5z"/>',
  inventory: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clients: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5"/>',
  delivery: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7V10z"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="17.5" cy="18" r="1.5"/>',
  analytics: '<path d="M5 19V11"/><path d="M12 19V5"/><path d="M19 19v-8"/>',
};

function navLink(page, currentPage, mobile = false) {
  const active = page.id === currentPage ? ' active' : '';
  const cls = mobile ? 'bottom-nav-item' : 'tab-btn';
  const icon = PAGE_ICONS[page.id] || '';
  if (mobile) {
    return `<a class="${cls}${active}" href="${getPageHref(page.id)}" aria-current="${active ? 'page' : 'false'}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
      <span>${page.label}</span>
    </a>`;
  }
  return `<a class="${cls}${active}" href="${getPageHref(page.id)}" aria-current="${active ? 'page' : 'false'}">${page.label}</a>`;
}

export function renderShell(currentPage) {
  const desktopTabs = PAGES.map((p) => navLink(p, currentPage)).join('');
  const bottomNav = PAGES.map((p) => navLink(p, currentPage, true)).join('');

  return `
    <a class="skip-link" href="#page-content">Skip to content</a>
    <div class="header">
      <div class="header-left">
        <a class="brand-mark" href="${getPageHref('home')}" aria-label="Venus POS home">V</a>
        <div>
          <h1>Venus POS</h1>
          <div class="sub">inventory &amp; register</div>
        </div>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="debugBtn" aria-label="Debug log" title="Debug log" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span class="fab-badge" id="debugBadge" style="display:none;">0</span>
        </button>
      </div>
    </div>

    <nav class="tabs" aria-label="Main navigation">
      ${desktopTabs}
    </nav>

    <nav class="bottom-nav" aria-label="Primary navigation">
      ${bottomNav}
    </nav>
  `;
}

export function renderModals() {
  return `
    <button class="fab" id="fabNewOrder" aria-label="New order" type="button">
      +
      <span class="fab-badge" id="fabBadge" style="display:none;">0</span>
    </button>

    <div class="modal-overlay modal-overlay--sheet" id="orderModal" hidden>
      <div class="modal modal--sheet" id="orderModalPanel" role="dialog" aria-modal="true" aria-labelledby="orderModalTitle">
        <div class="sheet-handle-wrap" data-sheet-drag-handle aria-hidden="true">
          <div class="sheet-handle"></div>
        </div>
        <div class="modal-sheet-body" id="orderModalBody"></div>
      </div>
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

    <div class="modal-overlay" id="editOverlay" hidden>
      <div class="modal" id="editModalBody"></div>
    </div>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `;
}

export function wireMobileNav() {
  /* Bottom nav links navigate directly — no dropdown wiring needed */
}

export function mountShell(currentPage) {
  const root = document.getElementById('app-root');
  if (!root) return;

  const content = root.innerHTML;
  root.innerHTML = renderShell(currentPage) + `<main id="page-content" class="page-view">${content}</main>` + renderModals();
}
