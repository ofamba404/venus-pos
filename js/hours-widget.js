/**
 * Register-home busy widget — one clock, one apply.
 * Writes store_fulfillment.busy_until via saveFulfillmentStatus.
 */
import {
  busyUntilFromNow,
  formatBusyUntilLabel,
  getFulfillmentStatus,
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
/** @type {string} HH:mm draft in the setter */
let draftClock = '';
let wired = false;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function clockValue(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function seedClock(status, now = new Date()) {
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
  return d;
}

function dayLabel(date, now = new Date()) {
  if (!date || !Number.isFinite(date.getTime())) return '';
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfter = new Date(startTomorrow);
  startDayAfter.setDate(startDayAfter.getDate() + 1);
  if (date >= startTomorrow && date < startDayAfter) return 'Tomorrow';
  if (date >= startToday && date < startTomorrow) return 'Today';
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

function formatFace(date) {
  if (!date || !Number.isFinite(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function currentDraftDate(now = new Date()) {
  return untilFromClock(draftClock || seedClock(getFulfillmentStatus(), now), now);
}

function paintClock(root) {
  const date = currentDraftDate();
  const face = root.querySelector('[data-hours-clock-face]');
  const day = root.querySelector('[data-hours-clock-day]');
  const input = root.querySelector('[data-hours-busy-until-time]');
  if (face) face.textContent = formatFace(date);
  if (day) day.textContent = dayLabel(date);
  if (input && draftClock) input.value = draftClock;
}

function setDraft(root, hhmm) {
  const next = toHHmm(hhmm);
  if (!next) return;
  draftClock = next;
  paintClock(root);
}

function widgetHtml() {
  const ready = hasFulfillmentSnapshot();
  const status = getFulfillmentStatus();
  const now = new Date();
  const busy = isBusyActive(status, now);
  const pending = !ready && loading && !loadError;
  if (!draftClock) draftClock = seedClock(status, now);
  const date = currentDraftDate(now);
  const disabled = saving ? 'disabled' : '';
  const note = pending
    ? 'Loading…'
    : loadError
      ? ready
        ? 'Couldn’t refresh'
        : 'Couldn’t load'
      : '';

  return `
    <div class="hours-card__hero${busy ? ' is-busy' : ''}">
      <label class="hours-card__clock">
        <span class="hours-card__kicker">Free again</span>
        <span class="hours-card__time${pending ? ' is-pending' : ''}" data-hours-clock-face>${escapeHtml(pending ? '—' : formatFace(date))}</span>
        <span class="hours-card__day" data-hours-clock-day>${escapeHtml(pending ? '' : dayLabel(date, now))}</span>
        <input
          type="time"
          class="hours-card__native"
          data-hours-busy-until-time
          value="${escapeHtml(draftClock)}"
          step="300"
          aria-label="Free again"
          ${disabled}
        />
      </label>
    </div>

    <div class="hours-card__nudge" role="group" aria-label="Jump the clock">
      <button type="button" class="hours-card__nudge-btn" data-hours-nudge-mins="30" ${disabled}>+30m</button>
      <button type="button" class="hours-card__nudge-btn" data-hours-nudge-mins="60" ${disabled}>+1h</button>
      <button type="button" class="hours-card__nudge-btn" data-hours-nudge-mins="120" ${disabled}>+2h</button>
      <button type="button" class="hours-card__nudge-btn" data-hours-nudge-mins="180" ${disabled}>+3h</button>
    </div>

    <button type="button" class="hours-card__apply" data-hours-busy-until ${disabled}>
      ${saving ? 'Saving…' : busy ? 'Update busy' : 'Set busy'}
    </button>
    ${
      busy
        ? `<button type="button" class="hours-card__quiet" data-hours-clear-busy ${disabled}>End now</button>`
        : ''
    }
    ${note ? `<div class="hours-card__note">${escapeHtml(note)}</div>` : ''}
  `;
}

export function renderHoursWidget() {
  const root = document.getElementById('hoursWidget');
  if (!root) return;
  root.innerHTML = widgetHtml();
}

async function withSaving(work) {
  saving = true;
  renderHoursWidget();
  try {
    await work();
    loadError = '';
    saving = false;
    const status = getFulfillmentStatus();
    draftClock = seedClock(status);
    renderHoursWidget();
  } catch (e) {
    saving = false;
    renderHoursWidget();
    showToast(e?.message || 'Could not save', true);
  }
}

function onRootClick(event) {
  const root = event.currentTarget;

  const nudge = event.target.closest?.('[data-hours-nudge-mins]');
  if (nudge) {
    const mins = Number(nudge.getAttribute('data-hours-nudge-mins') || 0);
    if (!mins) return;
    setDraft(root, clockValue(new Date(busyUntilFromNow(mins))));
    return;
  }

  if (event.target.closest?.('[data-hours-busy-until]')) {
    const until = untilFromClock(draftClock);
    if (!until) {
      showToast('Pick a free-again time', true);
      return;
    }
    void withSaving(async () => {
      await saveFulfillmentStatus({
        busyUntil: until.toISOString(),
        busyFor: getFulfillmentStatus().busyFor || 'both',
      });
      showToast(`Busy until ${formatBusyUntilLabel(getFulfillmentStatus()) || 'later'}`);
    });
    return;
  }

  if (event.target.closest?.('[data-hours-clear-busy]')) {
    void withSaving(async () => {
      await saveFulfillmentStatus({ busyUntil: null });
      draftClock = seedClock(getFulfillmentStatus());
      showToast('Busy period ended — open for orders');
    });
  }
}

function onRootInput(event) {
  if (!event.target.closest?.('[data-hours-busy-until-time]')) return;
  setDraft(event.currentTarget, event.target.value);
}

export function wireHoursWidget() {
  const root = document.getElementById('hoursWidget');
  if (!root || wired) return;
  wired = true;
  root.addEventListener('click', onRootClick);
  root.addEventListener('input', onRootInput);
  root.addEventListener('change', onRootInput);
  onFulfillmentChange(() => {
    if (saving) return;
    draftClock = seedClock(getFulfillmentStatus());
    renderHoursWidget();
  });
}

export async function refreshHoursWidget() {
  loading = true;
  if (!hasFulfillmentSnapshot()) renderHoursWidget();
  try {
    await loadFulfillmentStatus();
    loadError = '';
    draftClock = seedClock(getFulfillmentStatus());
  } catch (e) {
    loadError = e?.message || 'Could not load hours';
  } finally {
    loading = false;
    renderHoursWidget();
  }
}
