/**
 * Register-home busy card — same hours-dial as Admin → Hours.
 */
import {
  applyDialerDate,
  destroyHoursDialer,
  dialerSeedDate,
  formatDialClock,
  hoursDialHtml,
  syncHoursDialer,
  wireHoursDialer,
} from './hours-dial.js';
import {
  busyUntilFromNow,
  formatBusyUntilLabel,
  getFulfillmentStatus,
  hasFulfillmentSnapshot,
  isBusyActive,
  loadFulfillmentStatus,
  onFulfillmentChange,
  saveFulfillmentStatus,
} from './fulfillment.js';
import { escapeHtml, showToast } from './utils.js';

let loadError = '';
let loading = false;
let saving = false;
let wired = false;

function widgetHtml() {
  const ready = hasFulfillmentSnapshot();
  const status = getFulfillmentStatus();
  const busy = isBusyActive(status);
  const pending = !ready && loading && !loadError;
  const disabled = saving ? 'disabled' : '';
  const note = pending
    ? 'Loading…'
    : loadError
      ? ready
        ? 'Couldn’t refresh'
        : 'Couldn’t load'
      : '';

  if (pending) {
    return `<div class="hours-card__note">${escapeHtml(note)}</div>`;
  }

  return `
    ${hoursDialHtml(dialerSeedDate(status))}
    <div class="admin-hours__presets" role="group" aria-label="Jump the dial">
      <button type="button" class="admin-hours__chip" data-hours-busy-mins="30" ${disabled}>30 min</button>
      <button type="button" class="admin-hours__chip" data-hours-busy-mins="60" ${disabled}>1 hour</button>
      <button type="button" class="admin-hours__chip" data-hours-busy-mins="120" ${disabled}>2 hours</button>
      <button type="button" class="admin-hours__chip" data-hours-busy-mins="180" ${disabled}>3 hours</button>
    </div>
    <button type="button" class="admin-hours__primary" data-hours-action="save-busy" ${disabled}>
      ${saving ? 'Saving…' : busy ? 'Update busy' : 'Set busy'}
    </button>
    ${
      busy
        ? `<button type="button" class="admin-hours__secondary" data-hours-clear-busy ${disabled}>End now</button>`
        : ''
    }
    ${note ? `<div class="hours-card__note">${escapeHtml(note)}</div>` : ''}
  `;
}

function mountDial(root) {
  if (root.querySelector('[data-hours-dial]')) wireHoursDialer(root);
}

export function renderHoursWidget() {
  const root = document.getElementById('hoursWidget');
  if (!root) return;
  destroyHoursDialer(root);
  root.innerHTML = widgetHtml();
  mountDial(root);
}

function setSavingUi(on) {
  const root = document.getElementById('hoursWidget');
  if (!root) return;
  saving = on;
  root.querySelectorAll('[data-hours-action="save-busy"], [data-hours-clear-busy], [data-hours-busy-mins]').forEach((el) => {
    el.disabled = on;
  });
  const apply = root.querySelector('[data-hours-action="save-busy"]');
  if (apply) {
    apply.textContent = on ? 'Saving…' : isBusyActive() ? 'Update busy' : 'Set busy';
  }
}

async function withSaving(work) {
  setSavingUi(true);
  try {
    await work();
    loadError = '';
    saving = false;
    renderHoursWidget();
  } catch (e) {
    setSavingUi(false);
    showToast(e?.message || 'Could not save', true);
  }
}

function onRootClick(event) {
  const root = event.currentTarget;

  const preset = event.target.closest?.('[data-hours-busy-mins]');
  if (preset) {
    const mins = Number(preset.getAttribute('data-hours-busy-mins') || 0);
    if (!mins) return;
    applyDialerDate(root, new Date(busyUntilFromNow(mins)));
    return;
  }

  if (event.target.closest?.('[data-hours-action="save-busy"]')) {
    const until = syncHoursDialer(root);
    if (!until || !Number.isFinite(until.getTime())) {
      showToast('Pick a free-again time', true);
      return;
    }
    if (until.getTime() <= Date.now()) {
      showToast('Free time must be in the future', true);
      return;
    }
    void withSaving(async () => {
      await saveFulfillmentStatus({
        busyUntil: until.toISOString(),
        busyFor: getFulfillmentStatus().busyFor || 'both',
      });
      showToast(`Busy until ${formatBusyUntilLabel(getFulfillmentStatus()) || formatDialClock(until)}`);
    });
    return;
  }

  if (event.target.closest?.('[data-hours-clear-busy]')) {
    void withSaving(async () => {
      await saveFulfillmentStatus({ busyUntil: null });
      showToast('Busy period ended — open for orders');
    });
  }
}

export function wireHoursWidget() {
  const root = document.getElementById('hoursWidget');
  if (!root || wired) return;
  wired = true;
  root.addEventListener('click', onRootClick);
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
