/**
 * Mobile form viewport helpers — keep focused / expanded fields in view
 * above the soft keyboard without thrashing scroll position.
 *
 * Mirrors venus-store form-viewport: only nudge when occluded, prefer
 * minimal delta, and use visualViewport (not layout viewport).
 */

const COMFORT = 14;
const KEYBOARD_SETTLE_MS = 320;
const PREFERRED_SCROLLERS = [
  '.cart-sheet--compose',
  '.cart-sheet.is-active',
  '.cart-sheet',
];

let scheduledRaf = 0;
let settleTimer = 0;
/** @type {WeakMap<Element, () => void>} */
const watchers = new WeakMap();

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

function visibleBounds(pad) {
  const vv = window.visualViewport;
  const top = (vv ? vv.offsetTop : 0) + pad;
  const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - pad;
  return { top, bottom };
}

function footerOcclusion(el, bottom) {
  const modal = el?.closest?.('.modal') || document.getElementById('orderModal');
  const footer = modal?.querySelector?.('.cart-footer, .modal-btns');
  if (!footer) return bottom;
  const fr = footer.getBoundingClientRect();
  if (fr.height > 0 && fr.top < bottom) {
    return Math.max(fr.top - COMFORT, bottom - fr.height);
  }
  return bottom;
}

export function findScrollParent(el) {
  if (!el || el.nodeType !== 1) return null;

  for (const sel of PREFERRED_SCROLLERS) {
    const hit = el.closest?.(sel);
    if (!hit) continue;
    const style = getComputedStyle(hit);
    const oy = style.overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return hit;
  }

  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    if (
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function unionRect(elements) {
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  let any = false;
  for (const el of elements) {
    if (!el || typeof el.getBoundingClientRect !== 'function') continue;
    if (el.hidden || el.getAttribute?.('hidden') != null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    any = true;
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  if (!any) return null;
  return { top, bottom, left, right, height: bottom - top, width: right - left };
}

/**
 * Scroll the nearest overflow parent so `elements` sit in the visible
 * (keyboard-aware) viewport. Tall blocks keep their top anchored.
 *
 * @param {Element | Element[]} target
 * @param {{ behavior?: ScrollBehavior, padding?: number, scrollParent?: Element | null }} [opts]
 */
export function ensureVisible(target, opts = {}) {
  const elements = (Array.isArray(target) ? target : [target]).filter(Boolean);
  if (!elements.length) return;

  const pad = opts.padding ?? COMFORT;
  const behavior = opts.behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth');
  const anchor = elements[0];

  const run = () => {
    const rect = unionRect(elements);
    if (!rect) return;

    let { top: visTop, bottom: visBottom } = visibleBounds(pad);
    visBottom = footerOcclusion(anchor, visBottom);
    const visHeight = Math.max(0, visBottom - visTop);
    if (visHeight < 40) return;

    let delta = 0;
    if (rect.height > visHeight) {
      delta = rect.top - visTop;
    } else if (rect.bottom > visBottom) {
      delta = rect.bottom - visBottom;
      if (rect.top - delta < visTop) {
        delta = rect.top - visTop;
      }
    } else if (rect.top < visTop) {
      delta = rect.top - visTop;
    }

    if (Math.abs(delta) < 1.5) return;

    const scrollParent = opts.scrollParent || findScrollParent(anchor);
    if (scrollParent) {
      scrollParent.scrollBy({ top: delta, behavior });
    } else {
      window.scrollBy({ top: delta, behavior });
    }
  };

  cancelAnimationFrame(scheduledRaf);
  scheduledRaf = requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

/** Ensure visible now, then again after the soft keyboard finishes animating. */
export function ensureVisibleSoon(target, opts = {}) {
  ensureVisible(target, opts);
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    ensureVisible(target, {
      ...opts,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, KEYBOARD_SETTLE_MS);
}

/** Reveal an expanded block (dropdown / panel) under its anchor field. */
export function reveal(anchor, ...extras) {
  ensureVisibleSoon([anchor, ...extras].filter(Boolean));
}

export function isTextEntry(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'image'].includes(
    type,
  );
}

/**
 * While focus is inside `root`, re-anchor on visualViewport resize (keyboard).
 * @param {Element} root
 * @param {(active: Element) => Element | Element[] | null} resolveTarget
 */
export function watchKeyboard(root, resolveTarget) {
  if (!root || watchers.has(root)) return () => {};

  const onViewportChange = () => {
    const active = document.activeElement;
    if (!active || !root.contains(active) || !isTextEntry(active)) return;
    const target = resolveTarget?.(active) || active;
    ensureVisible(target, { behavior: 'auto' });
  };

  const vv = window.visualViewport;
  vv?.addEventListener('resize', onViewportChange);
  vv?.addEventListener('scroll', onViewportChange);

  const stop = () => {
    vv?.removeEventListener('resize', onViewportChange);
    vv?.removeEventListener('scroll', onViewportChange);
    watchers.delete(root);
  };
  watchers.set(root, stop);
  return stop;
}

/**
 * Blur text fields when the user taps outside them (dismisses mobile keyboard).
 * @param {Element} root
 * @param {{ ignoreSelector?: string }} [opts]
 */
export function blurOnOutsideTap(root, opts = {}) {
  if (!root) return () => {};

  const ignoreSelector =
    opts.ignoreSelector ||
    [
      '.suggest-menu',
      '.suggest-row',
      '.delivery-place-dropdown',
      '.delivery-place-row',
      '.client-autocomplete-dropdown',
    ].join(',');

  const onPointerDown = (event) => {
    const active = document.activeElement;
    if (!active || !isTextEntry(active) || !root.contains(active)) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    if (active === target || active.contains(target)) return;
    if (target.closest(ignoreSelector)) return;
    if (isTextEntry(target) || target.closest('input, textarea, select')) return;

    active.blur();
    if (event.cancelable) event.preventDefault();
  };

  root.addEventListener('pointerdown', onPointerDown, true);
  return () => root.removeEventListener('pointerdown', onPointerDown, true);
}
