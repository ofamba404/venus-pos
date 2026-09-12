/**
 * Register-home busy widget.
 * Same store_fulfillment busy_until as Admin → Hours — presets first, open hours tucked away.
 */
import {
  busyUntilFromNow,
  describeFulfillmentState,
  formatBusyUntilLabel,
  formatOpenHoursLabel,
  getFulfillmentStatus,
  hasBusyUntil,
  hasFulfillmentSnapshot,
  isBusyActive,
  loadFulfillmentStatus,
  onFulfillmentChange,
  saveFulfillmentStatus,
  toHHmm,
} from './fulfillment.js';
import { escapeHtml, showToast } from './utils.js';

let loadError = '';
let loading = false;
let saving = false;
let hoursOpen = false;
let wired = false;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function clockValue(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function defaultUntilClock(status, now = new Date()) {
  if (isBusyActive(status, now) && status.busyUntil) {
    const until = new Date(status.busyUntil);
    if (Number.isFinite(until.getTime())) return clockValue(until);
  }
  return clockValue(new Date(busyUntilFromNow(60)));
}

function untilFromClock(hhmm, now = new Date()) {
  const parsed = toHHmm(hhmm);
  if (!parsed) return null;
  const [h, m] = parsed.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function widgetHtml() {
  const ready = hasFulfillmentSnapshot();
  const status = getFulfillmentStatus();
  const now = new Date();
  const state = describeFulfillmentState(status, now);
  const busy = isBusyActive(status, now);
  const hasBusy = hasBusyUntil(status);
  const pending = !ready && loading && !loadError;
  const tone = pending ? '' : state.kind === 'busy' ? 'is-busy' : state.kind === 'closed' ? 'is-closed' : 'is-open';
  const badge = pending ? 'Busy' : state.label;
  const untilLine = pending
    ? 'Loading…'
    : busy
      ? `Free ${formatBusyUntilLabel(status) || 'later'}`
      : state.kind === 'closed'
        ? state.detail
        : formatOpenHoursLabel(status);
  const copy = pending
    ? 'Checking availability'
    : loadError
      ? ready
        ? 'Couldn’t refresh — showing last saved status'
        : 'Couldn’t load availability'
      : busy
        ? 'Customers can’t book until then'
        : state.kind === 'closed'
          ? state.detail
          : 'Tap a time to pause new orders';
  const openTime = status.openTime || '07:00';
  const closeTime = status.closeTime || '22:00';
  const customClock = defaultUntilClock(status, now);
  const disabled = saving ? 'disabled' : '';

  return `
    <div class="hours-card__status ${tone}">
      <div class="hours-card__status-row">
        <span class="hours-card__badge${pending ? ' is-pending' : ''}">${escapeHtml(badge)}</span>
        <span class="hours-card__until${pending ? ' is-pending' : ''}">${escapeHtml(untilLine)}</span>
      </div>
      <div class="hours-card__copy">${escapeHtml(copy)}</div>
    </div>

    ${
      busy || hasBusy
        ? `<button type="button" class="hours-card__end" data-hours-clear-busy ${disabled}>
            ${saving ? 'Saving…' : busy ? 'End busy now' : 'Clear expired busy'}
          </button>`
        : ''
    }

    <div class="hours-card__presets">
      <div class="hours-card__presets-label">${busy ? 'Extend' : 'Busy for'}</div>
      <div class="hours-card__chips" role="group" aria-label="Busy presets">
        <button type="button" class="admin-hours__chip" data-hours-busy-mins="30" ${disabled}>30 min</button>
        <button type="button" class="admin-hours__chip" data-hours-busy-mins="60" ${disabled}>1 hour</button>
        <button type="button" class="admin-hours__chip" data-hours-busy-mins="120" ${disabled}>2 hours</button>
        <button type="button" class="admin-hours__chip" data-hours-busy-mins="180" ${disabled}>3 hours</button>
      </div>
    </div>

    <div class="hours-card__custom">
      <label class="hours-card__custom-field">
        <span class="hours-card__custom-label">Until</span>
        <input type="time" class="admin-hours__input" data-hours-busy-until-time value="${escapeHtml(customClock)}" step="300" ${disabled} />
      </label>
      <button type="button" class="hours-card__set" data-hours-busy-until ${disabled}>
        ${busy ? 'Update' : 'Set busy'}
      </button>
    </div>

    <details class="hours-card__more" data-hours-edit ${hoursOpen ? 'open' : ''}>
      <summary class="hours-card__more-sum">
        <span>Open hours</span>
        <span class="hours-card__more-meta">${escapeHtml(formatOpenHoursLabel(status))}</span>
      </summary>
      <div class="hours-card__more-body">
        <p class="hours-card__hint">Daily window — storefront blocks times outside it.</p>
        <div class="admin-hours__range">
          <label class="admin-hours__field">
            <span class="admin-hours__field-label">Opens</span>
            <input type="time" class="admin-hours__input" data-hours-open-time value="${escapeHtml(openTime)}" step="300" ${disabled} />
          </label>
          <label class="admin-hours__field">
            <span class="admin-hours__field-label">Closes</span>
            <input type="time" class="admin-hours__input" data-hours-close-time value="${escapeHtml(closeTime)}" step="300" ${disabled} />
          </label>
        </div>
        <button type="button" class="admin-tool-btn" data-hours-save ${disabled}>
          ${saving ? 'Saving…' : 'Save open hours'}
        </button>
      </div>
    </details>
  `;
}

export function renderHoursWidget() {
  const root = document.getElementById('hoursWidget');
  if (!root) return;
  const details = root.querySelector('[data-hours-edit]');
  if (details) hoursOpen = details.open;
  root.innerHTML = widgetHtml();
}

async function withSaving(work) {
  saving = true;
  renderHoursWidget();
  try {
    await work();
    loadError = '';
    saving = false;
    renderHoursWidget();
  } catch (e) {
    saving = false;
    renderHoursWidget();
    showToast(e?.message || 'Could not save', true);
  }
}

function readOpenClose(root) {
  const openEl = root.querySelector('[data-hours-open-time]');
  const closeEl = root.querySelector('[data-hours-close-time]');
  return {
    openTime: toHHmm(openEl?.value) || '',
    closeTime: toHHmm(closeEl?.value) || '',
  };
}

function onRootClick(event) {
  const root = event.currentTarget;

  const saveHours = event.target.closest?.('[data-hours-save]');
  if (saveHours) {
    const form = readOpenClose(root);
    if (!form.openTime || !form.closeTime) {
      showToast('Set both open and close times', true);
      return;
    }
    if (form.openTime === form.closeTime) {
      showToast('Open and close can’t be the same — pick a window', true);
      return;
    }
    void withSaving(async () => {
      await saveFulfillmentStatus(form);
      showToast(`Open hours saved · ${formatOpenHoursLabel(getFulfillmentStatus())}`);
    });
    return;
  }

  const preset = event.target.closest?.('[data-hours-busy-mins]');
  if (preset) {
    const mins = Number(preset.getAttribute('data-hours-busy-mins') || 0);
    if (!mins) return;
    void withSaving(async () => {
      await saveFulfillmentStatus({
        busyUntil: busyUntilFromNow(mins),
        busyFor: getFulfillmentStatus().busyFor || 'both',
      });
      showToast(`Busy for ${mins >= 60 ? `${mins / 60}h` : `${mins}m`}`);
    });
    return;
  }

  const custom = event.target.closest?.('[data-hours-busy-until]');
  if (custom) {
    const raw = root.querySelector('[data-hours-busy-until-time]')?.value;
    const until = untilFromClock(raw);
    if (!until) {
      showToast('Pick a free-again time', true);
      return;
    }
    void withSaving(async () => {
      await saveFulfillmentStatus({
        busyUntil: until,
        busyFor: getFulfillmentStatus().busyFor || 'both',
      });
      showToast(`Busy until ${formatBusyUntilLabel(getFulfillmentStatus()) || 'later'}`);
    });
    return;
  }

  const clearBtn = event.target.closest?.('[data-hours-clear-busy]');
  if (clearBtn) {
    void withSaving(async () => {
      await saveFulfillmentStatus({ busyUntil: null });
      showToast('Busy period ended — open for orders');
    });
  }
}

function onRootToggle(event) {
  const details = event.target.closest?.('[data-hours-edit]');
  if (details) hoursOpen = details.open;
}

export function wireHoursWidget() {
  const root = document.getElementById('hoursWidget');
  if (!root || wired) return;
  wired = true;
  root.addEventListener('click', onRootClick);
  root.addEventListener('toggle', onRootToggle, true);
  onFulfillmentChange(() => {
    if (saving) return;
    renderHoursWidget();
  });
}

export async function refreshHoursWidget() {
  loading = true;
  if (!hasFulfillmentSnapshot()) renderHoursWidget();
  try {
    await loadFulfillmentStatus();
    loadError = '';
  } catch (e) {
    loadError = e?.message || 'Could not load hours';
  } finally {
    loading = false;
    renderHoursWidget();
  }
}
