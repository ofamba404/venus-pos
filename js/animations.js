let gsapPromise = null;
let gsapReady = false;

const DURATION = { fast: 0.18, normal: 0.28, slow: 0.5 };
const EASE = { out: 'power2.out', in: 'power2.in', bounce: 'back.out(1.7)' };

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}

function gsapPath() {
  return window.location.pathname.includes('/pages/') ? '../vendor/gsap.min.js' : 'vendor/gsap.min.js';
}

export function ensureGsap() {
  if (window.gsap) {
    gsapReady = true;
    document.body.classList.add('has-gsap');
    return Promise.resolve(window.gsap);
  }
  if (gsapPromise) return gsapPromise;

  gsapPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = gsapPath();
    script.async = true;
    script.onload = () => {
      if (window.gsap) {
        gsapReady = true;
        document.body.classList.add('has-gsap');
        resolve(window.gsap);
      } else resolve(null);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return gsapPromise;
}

export function hasGsap() {
  return gsapReady && !!window.gsap;
}

function gsap() {
  return window.gsap;
}

const sheetState = new WeakMap();
const sheetOptions = new WeakMap();

export function registerSheetModal(overlay, options = {}) {
  if (!overlay) return;
  sheetOptions.set(overlay, options);
}

export function initSheetModals() {
  document.querySelectorAll('.modal-overlay--dialog').forEach((overlay) => {
    setupSheetModal(overlay);
  });
}

function resetSheetClosed(overlay, panel, state) {
  if (hasGsap()) {
    gsap().killTweensOf([overlay, panel]);
    gsap().set(overlay, { opacity: 0, pointerEvents: 'none' });
    gsap().set(panel, { y: 16, scale: 0.96, opacity: 0, clearProps: 'transform' });
  } else {
    panel.style.transform = '';
    panel.style.opacity = '';
    overlay.style.opacity = '';
    overlay.style.pointerEvents = '';
  }
  overlay.hidden = true;
  state.isOpen = false;
}

export function setupSheetModal(overlay) {
  if (!overlay || sheetState.has(overlay)) return;

  const panel = overlay.querySelector('.modal');
  if (!panel) return;

  const state = { timeline: null, isOpen: false };

  if (hasGsap() && !prefersReducedMotion()) {
    gsap().set(overlay, { opacity: 0, pointerEvents: 'none' });
    gsap().set(panel, { y: 16, scale: 0.96, opacity: 0 });

    state.timeline = gsap().timeline({
      paused: true,
      onStart: () => {
        overlay.hidden = false;
      },
      onReverseComplete: () => {
        resetSheetClosed(overlay, panel, state);
      },
    });

    state.timeline.to(overlay, { opacity: 1, pointerEvents: 'auto', duration: 0.2, ease: EASE.out }, 0);
    state.timeline.to(panel, { y: 0, scale: 1, opacity: 1, duration: 0.28, ease: EASE.out }, 0);
  }

  panel.addEventListener('click', (e) => {
    if (!e.target.closest('[data-order-close]')) return;
    e.preventDefault();
    e.stopPropagation();
    const opts = sheetOptions.get(overlay);
    if (opts?.onDismiss) opts.onDismiss();
    else closeSheetModal(overlay);
  });

  sheetState.set(overlay, state);
}

export function isModalOpen(overlay) {
  return !!overlay && !overlay.hidden && !overlay._closing;
}

export function isSheetModalOpen(overlay) {
  return isModalOpen(overlay);
}

export function openSheetModal(overlay) {
  if (!overlay) return;

  setupSheetModal(overlay);
  const state = sheetState.get(overlay);

  if (!hasGsap() || prefersReducedMotion() || !state?.timeline) {
    overlay.hidden = false;
    if (state) state.isOpen = true;
    return;
  }

  if (state?.isOpen) return;

  state.isOpen = true;
  state.timeline.play(0);
}

export function closeSheetModal(overlay) {
  if (!overlay) return;

  const state = sheetState.get(overlay);
  const panel = overlay.querySelector('.modal');

  if (!state?.isOpen) {
    if (!overlay.hidden) overlay.hidden = true;
    return;
  }

  if (!hasGsap() || prefersReducedMotion() || !state.timeline) {
    resetSheetClosed(overlay, panel, state);
    return;
  }

  gsap().killTweensOf([overlay, panel]);
  gsap().set(panel, { clearProps: 'y' });
  state.timeline.reverse();
}

export function openModal(overlay, { instant = false } = {}) {
  if (!overlay) return;

  const modal = overlay.querySelector('.modal');

  if (overlay._closing) {
    overlay._closing = false;
    overlay._closeTween?.kill?.();
    overlay._closeTween = null;
    if (hasGsap()) gsap().killTweensOf([overlay, modal].filter(Boolean));
  }

  if (instant || !hasGsap() || prefersReducedMotion()) {
    overlay.hidden = false;
    if (hasGsap()) gsap().set([overlay, modal].filter(Boolean), { clearProps: 'opacity,transform' });
    return;
  }

  overlay.hidden = false;
  gsap().killTweensOf([overlay, modal].filter(Boolean));
  gsap().set(overlay, { opacity: 0 });
  // Opacity + translate only — scale causes subpixel shifts on nested text/prices
  if (modal) gsap().set(modal, { y: 20, opacity: 0, force3D: true });

  gsap()
    .timeline()
    .to(overlay, { opacity: 1, duration: 0.22, ease: EASE.out })
    .to(
      modal,
      { y: 0, opacity: 1, duration: 0.32, ease: 'power3.out', force3D: true },
      '-=0.16',
    );
}

export function closeModal(overlay, { instant = false } = {}) {
  if (!overlay || overlay.hidden) return;

  if (instant || !hasGsap() || prefersReducedMotion()) {
    overlay._closeTween?.kill?.();
    overlay._closeTween = null;
    overlay.hidden = true;
    overlay._closing = false;
    return;
  }

  const modal = overlay.querySelector('.modal');
  overlay._closing = true;
  overlay._closeTween?.kill?.();

  overlay._closeTween = gsap()
    .timeline({
      onComplete: () => {
        overlay.hidden = true;
        overlay._closing = false;
        overlay._closeTween = null;
        gsap().set([overlay, modal].filter(Boolean), { clearProps: 'opacity,transform' });
      },
    })
    .to(modal, { y: 12, opacity: 0, duration: 0.18, ease: EASE.in, force3D: true })
    .to(overlay, { opacity: 0, duration: 0.16, ease: EASE.in }, '-=0.08');
}

let toastHideTimer = null;
let toastTween = null;

export function animateToastIn(el) {
  if (!el) return;
  clearTimeout(toastHideTimer);
  toastTween?.kill();
  el.hidden = false;

  if (!hasGsap() || prefersReducedMotion()) {
    el.classList.add('show');
    return;
  }

  el.classList.remove('show');
  gsap().set(el, { xPercent: -50, y: 14, scale: 0.96, opacity: 0 });
  toastTween = gsap().to(el, {
    y: 0,
    scale: 1,
    opacity: 1,
    duration: DURATION.normal,
    ease: EASE.out,
  });
}

export function animateToastOut(el) {
  if (!el) return;
  toastTween?.kill();

  if (!hasGsap() || prefersReducedMotion()) {
    el.classList.remove('show');
    el.hidden = true;
    return;
  }

  toastTween = gsap().to(el, {
    y: 10,
    scale: 0.97,
    opacity: 0,
    duration: DURATION.fast,
    ease: EASE.in,
    onComplete: () => {
      el.classList.remove('show');
      el.hidden = true;
      gsap().set(el, { clearProps: 'opacity,transform' });
    },
  });
}

const PAGE_CONTENT_SELECTOR =
  '.kpi-grid > *, .stock-card, .section-head, .page-hint, .client-add-row, .client-search-wrap, .ao-hero, .ao-tiles > *, .ao-feature, .credit-panel, .analytics-block, .rev-chart-card, .pattern-card, .dl-model-card, .delivery-day-group, .delivery-stats, .delivery-log, .card, .section-title, .product-row, .client-row, .credit-row, .bar-row';

function markAppReady() {
  document.body.classList.add('is-ready');
}

export function animatePageEntrance() {
  const root = document.getElementById('app-root');
  const page = document.getElementById('page-content');
  if (!root || !page) {
    markAppReady();
    return;
  }

  if (!hasGsap() || prefersReducedMotion()) {
    markAppReady();
    return;
  }

  const targets = [
    ...root.querySelectorAll('.header, .tabs, .bottom-dock'),
    ...page.querySelectorAll(PAGE_CONTENT_SELECTOR),
  ];

  gsap().set(page, { opacity: 1 });
  if (!targets.length) {
    gsap().set(page, { opacity: 0, y: 10 });
    markAppReady();
    gsap().to(page, { opacity: 1, y: 0, duration: DURATION.normal, ease: EASE.out, clearProps: 'opacity,transform' });
    return;
  }

  gsap().set(targets, { opacity: 0, y: 12 });
  markAppReady();
  gsap().to(targets, {
    opacity: 1,
    y: 0,
    duration: DURATION.normal,
    stagger: 0.04,
    ease: EASE.out,
    clearProps: 'opacity,transform',
  });
}

export function staggerChildren(container, selector = ':scope > *') {
  if (!container) return;
  const children = container.querySelectorAll(selector);
  if (!children.length || !hasGsap() || prefersReducedMotion()) return;

  gsap().from(children, {
    y: 10,
    opacity: 0,
    duration: DURATION.normal,
    stagger: 0.035,
    ease: EASE.out,
    clearProps: 'opacity,transform',
  });
}

export function animateCheckoutSuccess(container) {
  if (!container) return;

  const mark = container.querySelector('.checkout-success-mark');
  const glow = container.querySelector('.checkout-success-mark-glow');
  const ring = container.querySelector('.checkout-success-mark-ring');
  const check = container.querySelector('.checkout-success-mark-check');
  const total = container.querySelector('.checkout-success-total');
  const sub = container.querySelector('.checkout-success-sub');
  const title = container.querySelector('.modal-title');
  const rest = container.querySelectorAll(
    '.checkout-success-badges, .checkout-receipt-item, .checkout-delivery-summary, .checkout-success-footer',
  );

  if (!hasGsap() || prefersReducedMotion()) {
    container.classList.add('checkout-success--static');
    return;
  }

  container.classList.remove('checkout-success--static');

  const targets = [mark, glow, total, sub, title, ...rest].filter(Boolean);
  gsap().killTweensOf(targets);
  if (ring) gsap().killTweensOf(ring);
  if (check) gsap().killTweensOf(check);

  const ringLen = ring?.getTotalLength?.() ?? 126;
  const checkLen = check?.getTotalLength?.() ?? 28;

  gsap().set(mark, { scale: 0.55, opacity: 0, transformOrigin: '50% 50%' });
  gsap().set(glow, { scale: 0.4, opacity: 0, transformOrigin: '50% 50%' });
  gsap().set(ring, { strokeDasharray: ringLen, strokeDashoffset: ringLen });
  gsap().set(check, { strokeDasharray: checkLen, strokeDashoffset: checkLen });
  gsap().set([title, sub].filter(Boolean), { opacity: 0, y: 12 });
  gsap().set(total, { opacity: 0, y: 14, scale: 0.92, transformOrigin: 'left center' });
  gsap().set(rest, { opacity: 0, y: 14 });

  const tl = gsap().timeline({ defaults: { ease: EASE.out } });

  tl.to(mark, { scale: 1, opacity: 1, duration: 0.38, ease: EASE.bounce }, 0)
    .to(glow, { scale: 1, opacity: 1, duration: 0.42 }, 0.02)
    .to(ring, { strokeDashoffset: 0, duration: 0.4, ease: 'power2.inOut' }, 0.04)
    .to(check, { strokeDashoffset: 0, duration: 0.28, ease: 'power2.out' }, 0.22)
    .to(glow, { opacity: 0.35, scale: 1.18, duration: 0.55, ease: 'power1.out' }, 0.28)
    .to(title, { opacity: 1, y: 0, duration: 0.3 }, 0.18)
    .to(total, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: EASE.bounce }, 0.24)
    .to(sub, { opacity: 1, y: 0, duration: 0.28 }, 0.34)
    .to(
      rest,
      {
        opacity: 1,
        y: 0,
        duration: 0.3,
        stagger: 0.045,
        clearProps: 'opacity,transform',
      },
      0.4,
    )
    .set([mark, glow, title, total, sub].filter(Boolean), {
      clearProps: 'opacity,transform',
    });
}

export function animateModalContent(container) {
  if (!container || !hasGsap() || prefersReducedMotion()) return;

  const items = container.querySelectorAll(
    '.modal-header, .cart-section, .cart-details, .cart-item, .cart-empty, .cart-total-row, .pick-product-card, .pick-product-section, .flavor-meter, .flavor-row, .flavor-fixed, .pick-row, .fixed-item, .modal-btns, .modal-price, .modal-progress, .qty-input, .qty-mini-input, .mini-step, .flavor-step, .cart-tool, .add-item-btn, .client-search-wrap, .client-autocomplete-dropdown > *, .credit-warning, .debug-note, .debug-log-text, .checkout-success-badges, .checkout-delivery-summary',
  );

  gsap().from(items.length ? items : container.children, {
    y: 8,
    opacity: 0,
    duration: 0.22,
    stagger: 0.025,
    ease: EASE.out,
    clearProps: 'opacity,transform',
  });
}

/** Animate the pack flavor meter fill between selection ratios (0–1). */
export function animateFlavorMeter(fill, { from = 0, to = 0 } = {}) {
  if (!fill) return;
  const start = Math.max(0, Math.min(1, Number(from) || 0));
  const end = Math.max(0, Math.min(1, Number(to) || 0));

  if (!hasGsap() || prefersReducedMotion()) {
    fill.style.transform = `scaleX(${end})`;
    fill.style.transformOrigin = 'left center';
    return;
  }

  gsap().killTweensOf(fill);
  gsap().fromTo(
    fill,
    { scaleX: start, transformOrigin: 'left center' },
    { scaleX: end, duration: 0.38, ease: 'power2.out', overwrite: 'auto' },
  );
}

function readTransformScaleX(el) {
  if (!el) return 0;
  if (hasGsap()) {
    const v = gsap().getProperty(el, 'scaleX');
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m = t.match(/^matrix\(([^)]+)\)$/);
  if (m) return parseFloat(m[1].split(',')[0]) || 0;
  const m3 = t.match(/^matrix3d\(([^)]+)\)$/);
  if (m3) return parseFloat(m3[1].split(',')[0]) || 0;
  return 0;
}

export function readFlavorMeterScale(fill) {
  return readTransformScaleX(fill);
}

/** Content transition inside an already-open dialog (mode switches only). */
export function animateCartSheetContent(container) {
  if (!container || !hasGsap() || prefersReducedMotion()) return;

  gsap().killTweensOf(container);
  gsap().fromTo(
    container,
    { y: 12, opacity: 0.5 },
    { y: 0, opacity: 1, duration: 0.28, ease: 'power2.out', clearProps: 'opacity,transform' },
  );
  animateModalContent(container);
}

export function animateDropdown(panel, open, { contentUpdate = false } = {}) {
  if (!panel) return;

  const enableDropdownScroll = () => {
    gsap().set(panel, {
      height: 'auto',
      opacity: 1,
      display: 'flex',
      pointerEvents: 'auto',
      clearProps: 'overflow',
    });
    panel.style.overflowX = 'hidden';
    panel.style.overflowY = 'auto';
  };

  if (!hasGsap() || prefersReducedMotion()) {
    panel.classList.toggle('open', open);
    if (open) {
      panel.style.height = 'auto';
      panel.style.overflowX = 'hidden';
      panel.style.overflowY = 'auto';
      refreshDropdownAncestors(panel);
    } else {
      panel.style.height = '';
      panel.style.overflowX = '';
      panel.style.overflowY = '';
    }
    return;
  }

  gsap().killTweensOf(panel);

  if (open) {
    const alreadyOpen = panel.classList.contains('open');
    panel.classList.add('open');

    if (contentUpdate && alreadyOpen) {
      enableDropdownScroll();
      refreshDropdownAncestors(panel);
      return;
    }

    const maxHeight = parseFloat(getComputedStyle(panel).maxHeight);
    gsap().set(panel, {
      display: 'flex',
      overflow: 'hidden',
      pointerEvents: 'none',
      height: 'auto',
      opacity: 0,
    });
    const contentHeight = panel.scrollHeight;
    const targetHeight =
      Number.isFinite(maxHeight) && maxHeight > 0 ? Math.min(contentHeight, maxHeight) : contentHeight;

    gsap()
      .timeline()
      .set(panel, { height: 0 })
      .to(panel, {
        height: targetHeight,
        duration: ACCORDION_HEIGHT_DURATION,
        ease: ACCORDION_HEIGHT_EASE,
      })
      .to(
        panel,
        {
          opacity: 1,
          duration: ACCORDION_FADE_DURATION,
          ease: ACCORDION_FADE_EASE,
          pointerEvents: 'auto',
        },
        ACCORDION_FADE_DELAY,
      )
      .call(() => {
        enableDropdownScroll();
        refreshDropdownAncestors(panel);
      });
    return;
  }

  gsap()
    .timeline()
    .set(panel, { overflow: 'hidden', pointerEvents: 'none' })
    .to(panel, { opacity: 0, duration: ACCORDION_FADE_DURATION * 0.65, ease: 'sine.in' })
    .to(panel, { height: 0, duration: ACCORDION_HEIGHT_DURATION * 0.85, ease: ACCORDION_HEIGHT_EASE }, 0.04)
    .call(() => {
      panel.classList.remove('open');
      gsap().set(panel, { clearProps: 'height,opacity,overflow,overflowX,overflowY,pointerEvents' });
    });
}

function refreshDropdownAncestors(panel) {
  if (!hasGsap()) return;
  const accordionPanel = panel.closest('[data-accordion-panel]');
  if (!accordionPanel) return;
  gsap().killTweensOf(accordionPanel);
  gsap().set(accordionPanel, { height: 'auto', overflow: 'visible' });
}

/** Wire header/body collapsible groups with the shared accordion animation. */
export function wireHeaderBodyAccordions(root, { headerSelector, getPanel = (header) => header.nextElementSibling }) {
  if (!root) return;

  root.querySelectorAll(headerSelector).forEach((header) => {
    const panel = getPanel(header);
    if (!panel) return;

    const startOpen = header.classList.contains('expanded');
    header.setAttribute('aria-expanded', String(startOpen));
    panel.removeAttribute('hidden');
    setAccordionPanelInstant(panel, startOpen);

    header.addEventListener('click', () => {
      const willOpen = !header.classList.contains('expanded');
      header.classList.toggle('expanded', willOpen);
      header.setAttribute('aria-expanded', String(willOpen));
      animateAccordionPanel(panel, willOpen);
    });
  });
}

const counterStates = new WeakMap();

export function animateCounter(el, toValue, formatter = (n) => String(Math.round(n)), { animate = true, fromValue } = {}) {
  if (!el) return;

  const to = Number(toValue);
  if (!Number.isFinite(to)) return;

  const fromDataset = parseFloat(el.dataset.counterValue);
  const fromText = parseUGX(el.textContent);
  const from = fromValue !== undefined ? Number(fromValue) : Number.isFinite(fromDataset) ? fromDataset : fromText;

  if (!animate || !hasGsap() || prefersReducedMotion()) {
    counterStates.get(el)?.tween?.kill();
    el.textContent = formatter(to);
    el.dataset.counterValue = String(to);
    return;
  }

  if (from === to) {
    counterStates.get(el)?.tween?.kill();
    el.textContent = formatter(to);
    el.dataset.counterValue = String(to);
    return;
  }

  let state = counterStates.get(el);
  if (!state) {
    state = { obj: { val: from } };
    counterStates.set(el, state);
  }

  state.obj.val = from;
  el.textContent = formatter(from);
  el.dataset.counterValue = String(from);

  state.tween?.kill();
  state.tween = gsap().to(state.obj, {
    val: to,
    duration: 0.55,
    ease: EASE.out,
    onUpdate: () => {
      el.textContent = formatter(state.obj.val);
    },
    onComplete: () => {
      el.textContent = formatter(to);
      el.dataset.counterValue = String(to);
      state.tween = null;
    },
  });
}

export function parseUGX(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[^\d.]/g, '')) || 0;
}

let lastFabCount = 0;

export function pulseFabBadge(count) {
  const fab = document.getElementById('fabNewOrder');
  const badge = document.getElementById('fabBadge');

  if (count > lastFabCount && count > 0) {
    if (hasGsap() && !prefersReducedMotion()) {
      if (fab) {
        gsap().fromTo(fab, { scale: 1 }, {
          scale: 1.05,
          duration: 0.1,
          yoyo: true,
          repeat: 1,
          ease: EASE.out,
          clearProps: 'transform',
        });
      }
      if (badge) {
        gsap().fromTo(badge, { scale: 0.4, opacity: 0 }, {
          scale: 1,
          opacity: 1,
          duration: 0.35,
          ease: EASE.bounce,
          clearProps: 'transform,opacity',
        });
      }
    }
  }
  lastFabCount = count;
}

export function bumpElement(el) {
  if (!el) return;

  if (!hasGsap() || prefersReducedMotion()) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    return;
  }

  gsap().fromTo(
    el,
    { scale: 1 },
    { scale: 1.12, duration: 0.1, yoyo: true, repeat: 1, ease: EASE.out, clearProps: 'transform' },
  );
}

export function applyBarFillWidths(root = document) {
  root.querySelectorAll('.bar-fill, .ao-tile-fill, .stock-stat-meter-fill').forEach((fill) => {
    const targetW = fill.dataset.fillWidth || fill.style.width;
    const targetH = fill.dataset.fillHeight || fill.style.height;
    if (targetW) {
      const pct = parseFillPct(targetW);
      if (pct == null) return;
      fill.style.width = '100%';
      fill.style.height = '';
      fill.style.transformOrigin = 'left center';
      fill.style.transform = `scaleX(${pct})`;
    } else if (targetH) {
      const pct = parseFillPct(targetH);
      if (pct == null) return;
      fill.style.height = '100%';
      fill.style.width = '';
      fill.style.transformOrigin = 'center bottom';
      fill.style.transform = `scaleY(${pct})`;
    }
  });
}

export function animateBarFills(root = document) {
  const fills = root.querySelectorAll('.bar-fill, .ao-tile-fill, .stock-stat-meter-fill');
  if (!fills.length || !hasGsap() || prefersReducedMotion()) return;

  fills.forEach((fill) => {
    const targetW = fill.dataset.fillWidth || fill.style.width;
    const targetH = fill.dataset.fillHeight || fill.style.height;
    gsap().killTweensOf(fill);

    if (targetW) {
      const pct = parseFillPct(targetW) ?? 0;
      fill.style.width = '100%';
      gsap().fromTo(
        fill,
        { scaleX: 0, transformOrigin: 'left center', immediateRender: true },
        { scaleX: pct, duration: 0.5, ease: EASE.out, overwrite: 'auto' },
      );
    } else if (targetH) {
      const pct = parseFillPct(targetH) ?? 0;
      fill.style.height = '100%';
      gsap().fromTo(
        fill,
        { scaleY: 0, transformOrigin: 'center bottom', immediateRender: true },
        { scaleY: pct, duration: 0.5, ease: EASE.out, overwrite: 'auto' },
      );
    }
  });
}

function parseFillPct(value) {
  if (value == null || value === '') return null;
  const n = parseFloat(String(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n)) / 100;
}

export function animateSparkline(container) {
  if (!container || !hasGsap() || prefersReducedMotion()) return;

  const bars = container.querySelectorAll('.ao-spark-bar');
  const line = container.querySelector('.ao-spark-line');
  if (!bars.length) return;

  gsap().from(bars, {
    scaleY: 0,
    transformOrigin: 'bottom center',
    duration: 0.42,
    stagger: 0.045,
    ease: EASE.out,
  });

  if (line?.getTotalLength) {
    const len = line.getTotalLength();
    gsap().set(line, { strokeDasharray: len, strokeDashoffset: len });
    gsap().to(line, { strokeDashoffset: 0, duration: 0.65, ease: EASE.out, delay: 0.12 });
  }
}

export function animateRevenueChart(block) {
  if (!block || !hasGsap() || prefersReducedMotion()) return;

  const area = block.querySelector('.rev-area');
  const line = block.querySelector('.rev-line');
  const dots = block.querySelectorAll('.rev-dot');

  if (area) {
    gsap().from(area, { opacity: 0, duration: 0.5, ease: EASE.out });
  }

  if (line?.getTotalLength) {
    const len = line.getTotalLength();
    gsap().set(line, { strokeDasharray: len, strokeDashoffset: len });
    gsap().to(line, { strokeDashoffset: 0, duration: 0.75, ease: EASE.out });
  }

  if (dots.length) {
    gsap().from(dots, {
      scale: 0,
      opacity: 0,
      duration: 0.3,
      stagger: 0.025,
      ease: EASE.bounce,
      transformOrigin: 'center center',
      delay: 0.2,
    });
  }
}

export function animateReveal(el) {
  if (!el) return;
  el.removeAttribute('hidden');

  if (!hasGsap() || prefersReducedMotion()) return;

  gsap().from(el, { opacity: 0, y: -8, duration: DURATION.normal, ease: EASE.out, clearProps: 'opacity,transform' });
}

export function animateScatterPoints(svg) {
  if (!svg || !hasGsap() || prefersReducedMotion()) return;

  const circles = svg.querySelectorAll('circle');
  gsap().from(circles, {
    scale: 0,
    opacity: 0,
    duration: 0.35,
    stagger: 0.04,
    ease: EASE.out,
    transformOrigin: 'center center',
  });
}

export function pressButton(el) {
  if (!el || !hasGsap() || prefersReducedMotion()) return;
  gsap().fromTo(
    el,
    { scale: 1 },
    { scale: 0.94, duration: 0.08, yoyo: true, repeat: 1, ease: EASE.out, clearProps: 'transform' },
  );
}

const ACCORDION_HEIGHT_DURATION = 0.3;
const ACCORDION_FADE_DURATION = 0.2;
const ACCORDION_FADE_DELAY = 0.04;
const ACCORDION_HEIGHT_EASE = 'power1.inOut';
const ACCORDION_FADE_EASE = 'sine.out';

export function animateAccordionPanel(panel, open) {
  if (!hasGsap() || prefersReducedMotion()) {
    panel.hidden = !open;
    return;
  }

  gsap().killTweensOf(panel);

  if (open) {
    gsap()
      .timeline()
      .set(panel, { overflow: 'hidden', pointerEvents: 'none', display: 'block' })
      .fromTo(
        panel,
        { height: 0, opacity: 0 },
        { height: 'auto', duration: ACCORDION_HEIGHT_DURATION, ease: ACCORDION_HEIGHT_EASE },
      )
      .to(
        panel,
        { opacity: 1, duration: ACCORDION_FADE_DURATION, ease: ACCORDION_FADE_EASE, pointerEvents: 'auto' },
        ACCORDION_FADE_DELAY,
      )
      .call(() => {
        gsap().set(panel, { overflow: 'visible' });
      });
    return;
  }

  gsap()
    .timeline()
    .set(panel, { overflow: 'hidden', pointerEvents: 'none' })
    .to(panel, { opacity: 0, duration: ACCORDION_FADE_DURATION * 0.65, ease: 'sine.in' })
    .to(panel, { height: 0, duration: ACCORDION_HEIGHT_DURATION * 0.85, ease: ACCORDION_HEIGHT_EASE }, 0.04)
    .call(() => {
      gsap().set(panel, { overflow: 'hidden' });
    });
}

export function setAccordionPanelInstant(panel, open) {
  if (hasGsap() && !prefersReducedMotion()) {
    gsap().killTweensOf(panel);
    if (open) {
      gsap().set(panel, { height: 'auto', opacity: 1, overflow: 'visible', pointerEvents: 'auto', display: 'block' });
    } else {
      gsap().set(panel, { height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none', display: 'block' });
    }
    return;
  }
  panel.hidden = !open;
}

/** Allbirds-style height + opacity accordions for dialog optional sections. */
export function wireGsapAccordions(root) {
  const controllers = new Map();
  if (!root) return { open: () => {}, close: () => {}, toggle: () => {} };

  root.querySelectorAll('[data-accordion]').forEach((accordion) => {
    const trigger = accordion.querySelector('[data-accordion-trigger]');
    const panel = accordion.querySelector('[data-accordion-panel]');
    const id = accordion.dataset.accordionId;
    if (!trigger || !panel || !id) return;

    const startOpen = accordion.dataset.accordionOpen === 'true';

    if (startOpen) {
      accordion.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      setAccordionPanelInstant(panel, true);
    } else {
      accordion.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      setAccordionPanelInstant(panel, false);
    }

    const setOpen = (open, animate = true) => {
      const isOpen = accordion.classList.contains('is-open');
      if (open === isOpen) return;
      accordion.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (animate) animateAccordionPanel(panel, open);
      else setAccordionPanelInstant(panel, open);
    };

    trigger.addEventListener('click', () => {
      setOpen(!accordion.classList.contains('is-open'));
    });

    controllers.set(id, {
      open: (animate = true) => setOpen(true, animate),
      close: (animate = true) => setOpen(false, animate),
      toggle: (animate = true) => setOpen(!accordion.classList.contains('is-open'), animate),
    });
  });

  return {
    open: (id, animate = true) => controllers.get(id)?.open(animate),
    close: (id, animate = true) => controllers.get(id)?.close(animate),
    toggle: (id, animate = true) => controllers.get(id)?.toggle(animate),
  };
}

let floatingNavOpen = false;
let floatingNavTween = null;

function resetNavClosed(nav, track, links) {
  nav.hidden = true;
  nav.setAttribute('aria-hidden', 'true');
  if (hasGsap()) {
    gsap().set(track, { scaleX: 0, opacity: 0, transformOrigin: '100% 50%' });
    gsap().set(links, { opacity: 0, y: 0, clearProps: 'transform' });
  } else {
    track.style.transform = 'scaleX(0)';
    track.style.opacity = '0';
    links.forEach((link) => {
      link.style.opacity = '0';
      link.style.transform = '';
    });
  }
}

export function wireFloatingNav() {
  const dock = document.getElementById('bottomDock');
  const toggle = document.getElementById('fabNavToggle');
  const nav = document.getElementById('floatingNav');
  const track = document.getElementById('bottomNavTrack');
  if (!dock || !toggle || !nav || !track) return;

  const items = () => nav.querySelectorAll('.bottom-nav-item');

  dock.classList.remove('is-open');
  toggle.classList.remove('is-open');
  toggle.setAttribute('aria-expanded', 'false');
  resetNavClosed(nav, track, items());

  const close = ({ animate = true } = {}) => {
    if (!floatingNavOpen) return;

    floatingNavOpen = false;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    toggle.classList.remove('is-open');

    floatingNavTween?.kill();
    const links = items();

    const finish = () => {
      dock.classList.remove('is-open');
      resetNavClosed(nav, track, links);
    };

    if (!animate || !hasGsap() || prefersReducedMotion()) {
      finish();
      return;
    }

    floatingNavTween = gsap()
      .timeline({ onComplete: finish })
      .to(links, {
        opacity: 0,
        y: 5,
        duration: 0.14,
        stagger: { each: 0.02, from: 'start' },
        ease: EASE.in,
      })
      .to(track, { scaleX: 0, opacity: 0, duration: 0.26, ease: 'power2.in' }, '-=0.04');
  };

  const open = () => {
    if (floatingNavOpen) return;

    floatingNavOpen = true;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation');
    toggle.classList.add('is-open');
    dock.classList.add('is-open');
    nav.hidden = false;
    nav.setAttribute('aria-hidden', 'false');

    floatingNavTween?.kill();
    const links = items();

    if (!hasGsap() || prefersReducedMotion()) {
      track.style.transform = 'scaleX(1)';
      track.style.opacity = '1';
      links.forEach((link) => {
        link.style.opacity = '1';
        link.style.transform = 'none';
      });
      return;
    }

    gsap().set(track, { scaleX: 0, opacity: 0, transformOrigin: '100% 50%' });
    gsap().set(links, { opacity: 0, y: 8 });

    floatingNavTween = gsap()
      .timeline()
      .to(track, { scaleX: 1, opacity: 1, duration: 0.42, ease: 'power3.out' })
      .to(
        links,
        {
          opacity: 1,
          y: 0,
          duration: 0.24,
          stagger: { each: 0.04, from: 'end' },
          ease: EASE.out,
        },
        '-=0.24',
      );
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (floatingNavOpen) close();
    else open();
  });

  nav.addEventListener('click', (e) => {
    if (e.target.closest('.bottom-nav-item')) close();
  });

  document.addEventListener('click', (e) => {
    if (!floatingNavOpen) return;
    if (e.target.closest('#bottomDock')) return;
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && floatingNavOpen) close();
  });
}
