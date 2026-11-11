/**
 * Alarm-style hour / minute / AM-PM wheel used by Admin → Hours and the home busy card.
 */
import { getFulfillmentStatus, isBusyActive, toDatetimeLocalValue } from './fulfillment.js';
import { escapeHtml } from './utils.js';

export const DIAL_MINUTE_STEP = 5;
const DIAL_ITEM_H = 40;

/** @type {WeakMap<HTMLElement, DialColController>} */
const dialColControllers = new WeakMap();

/**
 * @typedef {object} DialColController
 * @property {(value: string, opts?: { animate?: boolean }) => void} setValue
 * @property {() => void} destroy
 */

/** @param {Date} d */
export function snapDialMinutes(d) {
  const next = new Date(d.getTime());
  const snapped = Math.round(next.getMinutes() / DIAL_MINUTE_STEP) * DIAL_MINUTE_STEP;
  next.setSeconds(0, 0);
  if (snapped >= 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
  } else {
    next.setMinutes(snapped, 0, 0);
  }
  return next;
}

/** Seed dialer from active busy time, else ~30 min from now. */
export function dialerSeedDate(status = getFulfillmentStatus()) {
  if (isBusyActive(status) && status.busyUntil) {
    return snapDialMinutes(new Date(status.busyUntil));
  }
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  return snapDialMinutes(d);
}

/** @param {Date} d */
export function toDialParts(d) {
  const h24 = d.getHours();
  const minute = d.getMinutes();
  const ampm = h24 >= 12 ? 'pm' : 'am';
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, ampm, h24 };
}

/** @param {{ hour12: number, minute: number, ampm: string }} parts */
export function dialPartsToDate(parts, now = new Date()) {
  let h24 = Number(parts.hour12) % 12;
  if (parts.ampm === 'pm') h24 += 12;
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(h24, Number(parts.minute) || 0, 0, 0);
  if (d.getTime() <= now.getTime() + 30_000) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

export function formatDialClock(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDialDayLabel(d, now = new Date()) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfter = new Date(startTomorrow);
  startDayAfter.setDate(startDayAfter.getDate() + 1);
  if (d >= startTomorrow && d < startDayAfter) return 'Tomorrow';
  if (d >= startToday && d < startTomorrow) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function dialWheelHtml(kind, values, selected, formatLabel = (v) => String(v)) {
  const items = values
    .map((v) => {
      const sel = String(v) === String(selected) ? ' is-selected' : '';
      return `<button type="button" class="hours-dial__item${sel}" data-hours-dial-item="${escapeHtml(String(v))}" tabindex="-1">${escapeHtml(formatLabel(v))}</button>`;
    })
    .join('');
  return `
    <div class="hours-dial__col" data-hours-dial-col="${kind}" role="listbox" aria-label="${kind}">
      <div class="hours-dial__track">
        ${items}
      </div>
    </div>`;
}

/** Markup for the shared Free-again wheel. */
export function hoursDialHtml(seed = dialerSeedDate()) {
  const snapped = snapDialMinutes(seed instanceof Date && Number.isFinite(seed.getTime()) ? seed : dialerSeedDate());
  const parts = toDialParts(snapped);
  const untilLocal = toDatetimeLocalValue(snapped);
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 / DIAL_MINUTE_STEP }, (_, i) => i * DIAL_MINUTE_STEP);
  const padMin = (n) => String(n).padStart(2, '0');

  return `
    <div
      class="hours-dial"
      data-hours-dial
      data-hour="${parts.hour12}"
      data-minute="${parts.minute}"
      data-ampm="${parts.ampm}"
    >
      <div class="hours-dial__preview">
        <span class="hours-dial__preview-label">Free again</span>
        <span class="hours-dial__preview-time" data-hours-dial-preview>${escapeHtml(formatDialClock(snapped))}</span>
        <span class="hours-dial__preview-day" data-hours-dial-day>${escapeHtml(formatDialDayLabel(snapped))}</span>
      </div>

      <div class="hours-dial__frame" aria-hidden="false">
        <div class="hours-dial__highlight" aria-hidden="true"></div>
        <div class="hours-dial__wheels">
          ${dialWheelHtml('hour', hours, parts.hour12)}
          <div class="hours-dial__colon" aria-hidden="true">:</div>
          ${dialWheelHtml('minute', minutes, parts.minute, padMin)}
          ${dialWheelHtml('ampm', ['am', 'pm'], parts.ampm, (v) => String(v).toUpperCase())}
        </div>
      </div>

      <input type="hidden" data-hours-busy-until value="${escapeHtml(untilLocal)}" />
    </div>`;
}

/** @param {ParentNode|null} root */
export function destroyHoursDialer(root) {
  if (!root) return;
  root.querySelectorAll('[data-hours-dial-col]').forEach((col) => {
    dialColControllers.get(/** @type {HTMLElement} */ (col))?.destroy();
  });
}

/** @param {HTMLElement} root */
export function syncHoursDialer(root) {
  const dial = root.querySelector('[data-hours-dial]');
  if (!dial) return null;
  const hour12 = Number(dial.getAttribute('data-hour') || 12);
  const minute = Number(dial.getAttribute('data-minute') || 0);
  const ampm = dial.getAttribute('data-ampm') === 'pm' ? 'pm' : 'am';
  const date = dialPartsToDate({ hour12, minute, ampm });
  const untilEl = root.querySelector('[data-hours-busy-until]');
  if (untilEl) untilEl.value = toDatetimeLocalValue(date);
  const preview = root.querySelector('[data-hours-dial-preview]');
  const dayEl = root.querySelector('[data-hours-dial-day]');
  if (preview) preview.textContent = formatDialClock(date);
  if (dayEl) dayEl.textContent = formatDialDayLabel(date);
  return date;
}

/** @param {HTMLElement} root @param {Date} date */
export function applyDialerDate(root, date, { scroll = true } = {}) {
  const dial = root.querySelector('[data-hours-dial]');
  if (!dial) return;
  const snapped = snapDialMinutes(date);
  const parts = toDialParts(snapped);
  dial.setAttribute('data-hour', String(parts.hour12));
  dial.setAttribute('data-minute', String(parts.minute));
  dial.setAttribute('data-ampm', parts.ampm);
  dial.querySelectorAll('[data-hours-dial-col]').forEach((col) => {
    const kind = col.getAttribute('data-hours-dial-col');
    const want =
      kind === 'hour' ? String(parts.hour12) : kind === 'minute' ? String(parts.minute) : parts.ampm;
    const ctrl = dialColControllers.get(/** @type {HTMLElement} */ (col));
    if (ctrl && scroll) {
      ctrl.setValue(want, { animate: true });
    } else {
      col.querySelectorAll('[data-hours-dial-item]').forEach((item) => {
        item.classList.toggle('is-selected', item.getAttribute('data-hours-dial-item') === want);
      });
    }
  });
  syncHoursDialer(root);
}

/**
 * Transform-based wheel with momentum + spring lock to item centers.
 * @param {HTMLElement} col
 * @param {(value: string) => void} onCommit
 * @param {{ wrap?: boolean, onWrap?: (dir: 1|-1) => void }} [opts]
 * @returns {DialColController}
 */
function createDialColController(col, onCommit, opts = {}) {
  const track = /** @type {HTMLElement|null} */ (col.querySelector('.hours-dial__track'));
  const items = [...col.querySelectorAll('[data-hours-dial-item]')];
  if (!track || !items.length) {
    return { setValue() {}, destroy() {} };
  }

  const wrap = Boolean(opts.wrap);
  const onWrap = opts.onWrap;
  const maxIndex = items.length - 1;
  const cycle = (maxIndex + 1) * DIAL_ITEM_H;
  let index = items.findIndex((el) => el.classList.contains('is-selected'));
  if (index < 0) index = 0;

  let y = 0;
  let v = 0;
  let dragging = false;
  let locked = true;
  let raf = 0;
  let lastT = 0;
  let pointerId = /** @type {number|null} */ (null);
  let lastPointerY = 0;
  let lastMoveT = 0;
  let moved = false;
  let lastCommitted = '';

  const STIFFNESS = 380;
  const DAMPING = 34;
  const FRICTION = 0.952;
  const MIN_FLING = 90;
  const SETTLE_V = 12;
  const SETTLE_X = 0.35;

  const indexToY = (i) => -i * DIAL_ITEM_H;
  const clampIndex = (i) => Math.max(0, Math.min(maxIndex, Math.round(i)));
  const yToIndex = (pos) => clampIndex(-pos / DIAL_ITEM_H);
  const minY = indexToY(maxIndex);
  const maxY = indexToY(0);

  const applyY = () => {
    track.style.transform = `translate3d(0, ${y}px, 0)`;
  };

  const paintSelection = (i) => {
    items.forEach((el, n) => {
      el.classList.toggle('is-selected', n === i);
    });
  };

  const notify = (i) => {
    const value = items[i]?.getAttribute('data-hours-dial-item');
    if (value == null || value === lastCommitted) return;
    lastCommitted = value;
    onCommit(value);
  };

  const applyWrap = () => {
    if (!wrap) return;
    let guard = 0;
    while (y < minY - DIAL_ITEM_H * 0.5 && guard < 4) {
      y += cycle;
      onWrap?.(1);
      guard += 1;
    }
    while (y > maxY + DIAL_ITEM_H * 0.5 && guard < 4) {
      y -= cycle;
      onWrap?.(-1);
      guard += 1;
    }
  };

  const stopRaf = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const tick = (now) => {
    const dt = Math.min(0.033, Math.max(0.008, (now - lastT) / 1000));
    lastT = now;

    if (dragging) {
      raf = 0;
      return;
    }

    if (!locked) {
      v *= Math.pow(FRICTION, dt * 60);
      y += v * dt;

      if (wrap) {
        applyWrap();
      } else if (y > maxY) {
        y = maxY + (y - maxY) * 0.28;
        v *= 0.5;
      } else if (y < minY) {
        y = minY + (y - minY) * 0.28;
        v *= 0.5;
      }

      const live = yToIndex(y);
      paintSelection(live);
      notify(live);

      if (Math.abs(v) < MIN_FLING) {
        index = live;
        locked = true;
      }
    }

    if (locked) {
      const targetY = indexToY(index);
      const spring = -STIFFNESS * (y - targetY) - DAMPING * v;
      v += spring * dt;
      y += v * dt;
      paintSelection(index);

      if (Math.abs(v) < SETTLE_V && Math.abs(y - targetY) < SETTLE_X) {
        y = targetY;
        v = 0;
        applyY();
        notify(index);
        raf = 0;
        return;
      }
    }

    applyY();
    raf = requestAnimationFrame(tick);
  };

  const startRaf = () => {
    if (raf) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const snapTo = (i, { animate = true } = {}) => {
    if (wrap) {
      let next = i;
      let flips = 0;
      while (next > maxIndex && flips < 4) {
        next -= maxIndex + 1;
        onWrap?.(1);
        flips += 1;
      }
      while (next < 0 && flips < 4) {
        next += maxIndex + 1;
        onWrap?.(-1);
        flips += 1;
      }
      index = clampIndex(next);
    } else {
      index = clampIndex(i);
    }
    locked = true;
    paintSelection(index);
    notify(index);
    if (!animate) {
      stopRaf();
      v = 0;
      y = indexToY(index);
      applyY();
      return;
    }
    startRaf();
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pointerId = e.pointerId;
    dragging = true;
    locked = false;
    moved = false;
    v = 0;
    stopRaf();
    lastPointerY = e.clientY;
    lastMoveT = performance.now();
    col.classList.add('is-dragging');
    try {
      col.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e) => {
    if (pointerId == null || e.pointerId !== pointerId || !dragging) return;
    const now = performance.now();
    const dy = e.clientY - lastPointerY;
    if (Math.abs(dy) > 1.5) moved = true;
    y += dy;

    if (wrap) {
      applyWrap();
    } else if (y > maxY) {
      y = maxY + (y - maxY) * 0.4;
    } else if (y < minY) {
      y = minY + (y - minY) * 0.4;
    }

    const dt = Math.max(1, now - lastMoveT) / 1000;
    const instant = dy / dt;
    v = v * 0.35 + instant * 0.65;
    lastPointerY = e.clientY;
    lastMoveT = now;
    applyY();
    const live = yToIndex(y);
    paintSelection(live);
    notify(live);
  };

  const finishGesture = (e) => {
    if (pointerId == null || e.pointerId !== pointerId) return;
    pointerId = null;
    dragging = false;
    col.classList.remove('is-dragging');

    if (!moved && e.type === 'pointerup') {
      const t = /** @type {Element|null} */ (e.target);
      const btn = t?.closest?.('[data-hours-dial-item]');
      if (btn && col.contains(btn)) {
        const i = items.indexOf(/** @type {HTMLElement} */ (btn));
        if (i >= 0) {
          snapTo(i, { animate: true });
          return;
        }
      }
    }

    if (wrap) applyWrap();
    const coast = Math.max(-2.6, Math.min(2.6, v / -520));
    let next = yToIndex(y) + coast;
    if (wrap) {
      snapTo(next, { animate: true });
      return;
    }
    index = clampIndex(next);
    locked = true;
    paintSelection(index);
    startRaf();
  };

  const onWheel = (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    snapTo(index + dir, { animate: true });
  };

  col.addEventListener('pointerdown', onPointerDown);
  col.addEventListener('pointermove', onPointerMove);
  col.addEventListener('pointerup', finishGesture);
  col.addEventListener('pointercancel', finishGesture);
  col.addEventListener('wheel', onWheel, { passive: false });

  y = indexToY(index);
  applyY();
  paintSelection(index);
  lastCommitted = items[index].getAttribute('data-hours-dial-item') || '';

  return {
    setValue(value, { animate = true } = {}) {
      const i = items.findIndex((el) => el.getAttribute('data-hours-dial-item') === String(value));
      if (i < 0) return;
      index = clampIndex(i);
      locked = true;
      paintSelection(index);
      lastCommitted = String(value);
      onCommit(String(value));
      if (!animate) {
        stopRaf();
        v = 0;
        y = indexToY(index);
        applyY();
        return;
      }
      startRaf();
    },
    destroy() {
      stopRaf();
      col.removeEventListener('pointerdown', onPointerDown);
      col.removeEventListener('pointermove', onPointerMove);
      col.removeEventListener('pointerup', finishGesture);
      col.removeEventListener('pointercancel', finishGesture);
      col.removeEventListener('wheel', onWheel);
      dialColControllers.delete(col);
    },
  };
}

/** @param {HTMLElement} root */
export function wireHoursDialer(root) {
  const dial = root.querySelector('[data-hours-dial]');
  if (!dial) return;

  const commitValue = (col, value) => {
    const kind = col.getAttribute('data-hours-dial-col');
    if (!kind || value == null) return;
    if (kind === 'hour') dial.setAttribute('data-hour', value);
    else if (kind === 'minute') dial.setAttribute('data-minute', value);
    else if (kind === 'ampm') dial.setAttribute('data-ampm', value);
    syncHoursDialer(root);
  };

  const flipAmPm = () => {
    const next = dial.getAttribute('data-ampm') === 'pm' ? 'am' : 'pm';
    dial.setAttribute('data-ampm', next);
    const ampmCol = /** @type {HTMLElement|null} */ (root.querySelector('[data-hours-dial-col="ampm"]'));
    const ctrl = ampmCol ? dialColControllers.get(ampmCol) : null;
    if (ctrl) ctrl.setValue(next, { animate: true });
    else commitValue(ampmCol || dial, next);
    syncHoursDialer(root);
  };

  dial.querySelectorAll('[data-hours-dial-col]').forEach((colEl) => {
    const col = /** @type {HTMLElement} */ (colEl);
    const kind = col.getAttribute('data-hours-dial-col');
    const existing = dialColControllers.get(col);
    if (existing) existing.destroy();
    const ctrl = createDialColController(
      col,
      (value) => commitValue(col, value),
      kind === 'hour'
        ? {
            wrap: true,
            onWrap: () => {
              flipAmPm();
            },
          }
        : {},
    );
    dialColControllers.set(col, ctrl);
  });

  syncHoursDialer(root);
}
