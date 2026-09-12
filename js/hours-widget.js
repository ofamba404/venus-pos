/**
 * Register-home hours widget.
 * Reads/writes the same store_fulfillment row as Admin → Hours.
 */
import {
  busyUntilFromNow,
  describeFulfillmentState,
  formatHoursCompact,
  formatOpenHoursLabel,
  getFulfillmentStatus,
  hasFulfillmentSnapshot,
  isBusyActive,
  loadFulfillmentStatus,
  onFulfillmentChange,
  saveFulfillmentStatus,
  toHHmm,
} from './fulfillment.js';
import { escapeHtml, showToast } from './utils.js';

const WEEK = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
];

let loadError = '';
let loading = false;
let saving = false;
let editorOpen = false;
let wired = false;

function weekHtml(status, now) {
  const today = now.getDay();
  const compact = formatHoursCompact(status);
  return WEEK.map((day) => {
    const isToday = day.dow === today;
    return `<div class="hours-card__day${isToday ? ' is-today' : ''}" aria-current="${isToday ? 'date' : 'false'}">
      <span class="hours-card__day-name">${day.label}</span>
      <span class="hours-card__day-hrs">${escapeHtml(compact)}</span>
    </div>`;
  }).join('');
}

function widgetHtml() {
  const ready = hasFulfillmentSnapshot();
  const status = getFulfillmentStatus();
  const now = new Date();
  const state = describeFulfillmentState(status, now);
  const busy = isBusyActive(status, now);
  const openTime = status.openTime || '07:00';
  const closeTime = status.closeTime || '22:00';
  const pending = !ready && loading && !loadError;
  const tone = pending ? '' : state.kind === 'busy' ? 'is-busy' : state.kind === 'closed' ? 'is-closed' : 'is-open';
  const badge = pending ? 'Hours' : state.label;
  const todayLine = pending ? 'Loading…' : `Today ${state.hoursLabel}`;
  const copy = pending
    ? 'Checking store hours'
    : loadError
      ? ready
        ? 'Couldn’t refresh — showing last saved hours'
        : 'Couldn’t load hours from the server'
      : state.kind === 'open'
        ? 'Every day · customers can book now'
        : state.detail;

  return `
    <div class="hours-card__status ${tone}">
      <div class="hours-card__status-row">
        <span class="hours-card__badge${pending ? ' is-pending' : ''}">${escapeHtml(badge)}</span>
        <span class="hours-card__today${pending ? ' is-pending' : ''}">${escapeHtml(todayLine)}</span>
      </div>
      <div class="hours-card__copy">${escapeHtml(copy)}</div>
    </div>

    <div class="hours-card__week" role="list" aria-label="This week's hours">
      ${weekHtml(status, now)}
    </div>

    <details class="hours-card__edit" data-hours-edit ${editorOpen ? 'open' : ''}>
      <summary class="hours-card__edit-sum">
        <span>Edit weekly hours</span>
        <span class="hours-card__edit-meta">${escapeHtml(formatOpenHoursLabel(status))}</span>
      </summary>
      <div class="hours-card__edit-body">
        <p class="hours-card__hint">Same window every day — storefront blocks times outside it.</p>
        <div class="admin-hours__range">
          <label class="admin-hours__field">
            <span class="admin-hours__field-label">Opens</span>
            <input type="time" class="admin-hours__input" data-hours-open-time value="${escapeHtml(openTime)}" step="300" ${saving ? 'disabled' : ''} />
          </label>
          <label class="admin-hours__field">
            <span class="admin-hours__field-label">Closes</span>
            <input type="time" class="admin-hours__input" data-hours-close-time value="${escapeHtml(closeTime)}" step="300" ${saving ? 'disabled' : ''} />
          </label>
        </div>
        <button type="button" class="hours-card__save" data-hours-save ${saving ? 'disabled' : ''}>
          ${saving ? 'Saving…' : 'Save hours'}
        </button>
        <div class="hours-card__busy">
          <span class="hours-card__busy-label">${busy ? 'Stay busy' : 'Mark busy'}</span>
          <div class="hours-card__chips" role="group" aria-label="Busy presets">
            <button type="button" class="admin-hours__chip" data-hours-busy-mins="30" ${saving ? 'disabled' : ''}>30 min</button>
            <button type="button" class="admin-hours__chip" data-hours-busy-mins="60" ${saving ? 'disabled' : ''}>1 hour</button>
            <button type="button" class="admin-hours__chip" data-hours-busy-mins="120" ${saving ? 'disabled' : ''}>2 hours</button>
            <button type="button" class="admin-hours__chip hours-card__chip-clear" data-hours-clear-busy ${saving || !busy ? 'disabled' : ''}>Clear</button>
          </div>
        </div>
      </div>
    </details>
  `;
}

export function renderHoursWidget() {
  const root = document.getElementById('hoursWidget');
  if (!root) return;
  const details = root.querySelector('[data-hours-edit]');
  if (details) editorOpen = details.open;
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
    showToast(e?.message || 'Could not save hours', true);
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
  const saveBtn = event.target.closest?.('[data-hours-save]');
  if (saveBtn) {
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
      showToast(`Hours saved · ${formatOpenHoursLabel(getFulfillmentStatus())}`);
    });
    return;
  }

  const busyBtn = event.target.closest?.('[data-hours-busy-mins]');
  if (busyBtn) {
    const mins = Number(busyBtn.getAttribute('data-hours-busy-mins') || 0);
    if (!mins) return;
    void withSaving(async () => {
      const until = busyUntilFromNow(mins);
      await saveFulfillmentStatus({
        busyUntil: until,
        busyFor: getFulfillmentStatus().busyFor || 'both',
      });
      showToast(`Busy for ${mins >= 60 ? `${mins / 60}h` : `${mins}m`}`);
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
  if (details) editorOpen = details.open;
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
