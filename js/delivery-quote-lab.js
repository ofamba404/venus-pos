/**
 * Quote lab — manual SafeBoda fee logging against preset routes.
 * Rows land in `deliveries` with sale_id null and compound the fee model.
 */

import { sbFetch } from './api.js';
import { dataStore } from './store/index.js';
import { deliveries } from './state.js';
import { escapeHtml, fmtUGX, showToast } from './utils.js';
import {
  FIT_TARGET,
  TEST_CLIENT_NAME,
  TEST_DROPOFFS,
  CALIBRATION_SEARCHES,
  BASE_ORIGIN,
  DELIVERY_TEST_REMINDERS,
  analyzeCoverage,
  getDropoffById,
  isTestQuote,
} from './delivery-test-routes.js';
import {
  fitDeliveryFeeModel,
  periodForDate,
  periodMeta,
  predictSafeBodaFee,
} from './delivery-fee-model.js';
import {
  deliveryPlaceFieldMarkup,
  loadGoogleMaps,
  wireSinglePlaceAutocomplete,
} from './places-autocomplete.js';
import {
  ensureNotificationPermission,
  getNotificationPrefs,
  notificationPermission,
  setLocalSchedules,
  setNotificationPrefs,
  showAppNotification,
  startNotificationRuntime,
  subscribeWebPush,
  syncWebPushPrefs,
} from './notifications.js';

const ICON_CASH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.3" y="6.2" width="19.4" height="11.6" rx="2.1"></rect><circle cx="12" cy="12" r="2.7"></circle><path d="M6 9.4v.01M18 14.6v.01"></path></svg>`;
const ICON_ROUTE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"></circle><circle cx="18" cy="18" r="2.4"></circle><path d="M6 8.4v4.2a3.4 3.4 0 0 0 3.4 3.4h5.2"></path></svg>`;

function liveModel() {
  return fitDeliveryFeeModel(deliveries);
}

let selectedDropId = null;
/** Custom Places pick — used when selectedDropId is null / 'custom'. */
let customDrop = null;
/** @type {{ km: number, mins: number, dropId?: string } | null} */
let routeMetrics = null;
let feeDraft = '';
let saving = false;
let labWired = false;
/** Only auto-scroll to #quote-lab once per visit — not after every save refresh. */
let didScrollToLab = false;
/** Ignore stale Distance Matrix callbacks when the selected drop changes. */
let metricsRequestGen = 0;

function setSaveButtonSaving(isSaving) {
  const saveBtn = document.getElementById('quoteLabSave');
  if (!saveBtn) return;
  saveBtn.disabled = !!isSaving;
  saveBtn.classList.toggle('is-saving', !!isSaving);
  saveBtn.setAttribute('aria-busy', isSaving ? 'true' : 'false');
}

function preferNextDrop(coverage) {
  if (selectedDropId === 'custom') return 'custom';
  if (selectedDropId && getDropoffById(selectedDropId)) return selectedDropId;
  return coverage.nextRecommended?.drop?.id || TEST_DROPOFFS[0].id;
}

function activeDrop() {
  if (selectedDropId === 'custom') return customDrop;
  return getDropoffById(selectedDropId);
}

function metricsLineHtml(metrics) {
  if (!metrics) return `${ICON_ROUTE} Measuring route…`;
  return `${ICON_ROUTE} ${metrics.km.toFixed(1)} km · ~${Math.round(metrics.mins)} min driving`;
}

function predictLineText(metrics) {
  if (!metrics) return '\u00a0';
  const model = liveModel();
  const predicted = predictSafeBodaFee(metrics.km, model, {
    durationMin: metrics.mins,
    at: new Date(),
  });
  return predicted != null
    ? `Model guess now: ${fmtUGX(predicted)} — enter the real SafeBoda quote`
    : 'Model not ready yet — your quote still helps train it';
}

function computeRouteMetrics(drop) {
  if (!drop || drop.lat == null || drop.lng == null) {
    routeMetrics = null;
    updateMetricsReadout();
    return;
  }

  const reqId = ++metricsRequestGen;
  // Keep prior readout (same height) while Distance Matrix runs — no collapse.
  if (!routeMetrics || routeMetrics.dropId !== drop.id) {
    updateMetricsReadout({ measuring: true });
  }

  loadGoogleMaps(() => {
    const service = new google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      {
        origins: [{ lat: BASE_ORIGIN.lat, lng: BASE_ORIGIN.lng }],
        destinations: [{ lat: drop.lat, lng: drop.lng }],
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (res, status) => {
        if (reqId !== metricsRequestGen) return;
        if (status === 'OK' && res.rows[0]?.elements[0]?.status === 'OK') {
          const el = res.rows[0].elements[0];
          routeMetrics = {
            km: el.distance.value / 1000,
            mins: el.duration.value / 60,
            dropId: drop.id,
          };
        } else {
          const fallbackKm = drop.approxKm > 0 ? drop.approxKm : 3;
          routeMetrics = {
            km: fallbackKm,
            mins: (fallbackKm / 18) * 60,
            dropId: drop.id,
          };
        }
        updateMetricsReadout();
      },
    );
  });
}

function updateMetricsReadout({ measuring = false } = {}) {
  const el = document.getElementById('quoteLabMetrics');
  const predEl = document.getElementById('quoteLabPredict');
  if (!el) return;

  if (measuring && routeMetrics) {
    // Keep numbers visible while remeasuring the same/next drop.
    el.innerHTML = metricsLineHtml(routeMetrics);
    if (predEl) predEl.textContent = predictLineText(routeMetrics);
    return;
  }

  if (!routeMetrics) {
    el.innerHTML = measuring
      ? metricsLineHtml(null)
      : `${ICON_ROUTE} Select a drop-off to measure the route…`;
    if (predEl) predEl.textContent = '\u00a0';
    return;
  }

  el.innerHTML = metricsLineHtml(routeMetrics);
  if (predEl) predEl.textContent = predictLineText(routeMetrics);
}

function coverageBadgeClass(count, target) {
  if (count >= target) return 'ok';
  if (count >= Math.ceil(target / 2)) return 'mid';
  return 'low';
}

function buildPeriodBars(coverage) {
  return coverage.periodGaps
    .slice()
    .sort((a, b) => {
      const order = ['morning_peak', 'day', 'evening_peak', 'night'];
      return order.indexOf(a.id) - order.indexOf(b.id);
    })
    .map((p) => {
      const pct = Math.min(100, Math.round((p.count / FIT_TARGET.perPeriod) * 100));
      const cls = coverageBadgeClass(p.count, FIT_TARGET.perPeriod);
      return `<div class="ql-period">
        <div class="ql-period-top">
          <span>${escapeHtml(p.label)} <span class="ql-muted">${escapeHtml(p.hint)}</span></span>
          <span class="ql-period-count ${cls}">${p.count}/${FIT_TARGET.perPeriod}</span>
        </div>
        <div class="ql-bar"><div class="ql-bar-fill ${cls}" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join('');
}

function buildDropChips(coverage) {
  const nowPeriod = periodForDate(new Date());
  return TEST_DROPOFFS.map((d) => {
    const n = coverage.matrix[nowPeriod]?.[d.id] || 0;
    const selected = d.id === selectedDropId ? ' selected' : '';
    const gap = n < FIT_TARGET.minPerCell ? ' gap' : '';
    return `<button type="button" class="ql-chip${selected}${gap}" data-drop="${d.id}" title="${escapeHtml(d.why)}">
      <span class="ql-chip-name">${escapeHtml(d.shortLabel)}</span>
      <span class="ql-chip-meta">~${d.approxKm} km · ${d.band}</span>
      <span class="ql-chip-count">${n}/${FIT_TARGET.minPerCell} this period</span>
    </button>`;
  }).join('');
}

function calibrationHintsHtml() {
  return CALIBRATION_SEARCHES.map(
    (c) =>
      `<button type="button" class="ql-calib-chip" data-calib-search="${escapeHtml(c.searchAs)}" title="${escapeHtml(c.note)}">${escapeHtml(c.shortLabel)}</button>`
  ).join('');
}

function reminderStatusHtml() {
  const perm = notificationPermission();
  const prefs = getNotificationPrefs();
  const enabled = prefs.schedulesEnabled && perm === 'granted';
  const pushOn = prefs.pushSubscribed && enabled;
  const slots = DELIVERY_TEST_REMINDERS.map((r) => {
    const hh = String(r.hour).padStart(2, '0');
    const mm = String(r.minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }).join(' · ');

  let status = 'Reminders off';
  let statusCls = 'low';
  if (perm === 'unsupported') {
    status = 'This browser has no notifications';
  } else if (perm === 'denied') {
    status = 'Blocked — use in-app banners only (enable in browser settings)';
  } else if (perm === 'default') {
    status = 'Tap Enable for closed-browser push + in-app reminders';
    statusCls = 'mid';
  } else if (pushOn) {
    status = 'Push on — fires even if the browser is closed';
    statusCls = 'ok';
  } else if (enabled) {
    status = 'On while POS is open only — tap Enable again to register push';
    statusCls = 'mid';
  } else {
    status = 'Permission granted — schedules paused';
    statusCls = 'mid';
  }

  return `<div class="ql-remind">
    <div class="ql-remind-copy">
      <div class="ql-remind-title">Quote reminders</div>
      <div class="ql-remind-slots">Kampala · ${slots}</div>
      <div class="ql-remind-status ${statusCls}">${escapeHtml(status)}</div>
    </div>
    <div class="ql-remind-actions">
      ${
        perm !== 'granted'
          ? `<button type="button" class="ql-btn primary" id="quoteLabEnableNotif">Enable</button>`
          : `<button type="button" class="ql-btn" id="quoteLabToggleSched" aria-pressed="${enabled}">${enabled ? 'Pause' : 'Resume'}</button>`
      }
      <button type="button" class="ql-btn ghost" id="quoteLabTestNotif">Test ping</button>
    </div>
  </div>`;
}

export function renderQuoteLab() {
  const root = document.getElementById('deliveryTestBench');
  if (!root) return;

  const coverage = analyzeCoverage(deliveries);
  selectedDropId = preferNextDrop(coverage);
  const drop = activeDrop();
  const nowPeriod = periodMeta(periodForDate(new Date()));
  const progressPct = Math.round(coverage.progressStrong * 100);
  const next = coverage.nextRecommended;
  const customSelected = selectedDropId === 'custom';

  // Seed metrics/predict on paint so a re-render never collapses those rows.
  let seedMetrics = routeMetrics;
  if (drop && drop.approxKm != null && (!routeMetrics || routeMetrics.dropId !== drop.id)) {
    seedMetrics = {
      km: drop.approxKm,
      mins: (drop.approxKm / 18) * 60,
      dropId: drop.id,
    };
  }

  const nextHtml = next
    ? `<div class="ql-next">Next priority: <strong>${escapeHtml(next.periodLabel)}</strong> → ${escapeHtml(next.drop.shortLabel)} <span class="ql-muted">(${next.cellCount || 0}/${FIT_TARGET.minPerCell} · ~${next.drop.approxKm} km)</span></div>`
    : `<div class="ql-next ok">Preset cells at ≥${FIT_TARGET.minPerCell} each — keep logging sparse periods, customs, or stretch to ${FIT_TARGET.totalNearPerfect}.</div>`;

  root.innerHTML = `
    <section class="ql-card" id="quote-lab">
      <div class="ql-head">
        <div>
          <div class="ql-eyebrow">Quote lab</div>
          <h2 class="ql-title">Manual SafeBoda logging</h2>
          <p class="ql-sub">Fixed pickup: <strong>${escapeHtml(BASE_ORIGIN.shortLabel)}</strong>. Open SafeBoda with the same pickup, read the fee, log it here. Real checkouts count too.</p>
        </div>
        <div class="ql-progress-ring" title="${coverage.total} of ${FIT_TARGET.totalStrong} quotes toward strong fit">
          <span class="ql-progress-num">${progressPct}%</span>
          <span class="ql-progress-label">of strong target</span>
        </div>
      </div>

      <div class="ql-stats">
        <div class="ql-stat"><span class="ql-stat-val">${coverage.total}</span><span class="ql-stat-lbl">All quotes</span></div>
        <div class="ql-stat"><span class="ql-stat-val">${coverage.testCount}</span><span class="ql-stat-lbl">Lab tests</span></div>
        <div class="ql-stat"><span class="ql-stat-val">${coverage.logsStillNeeded}</span><span class="ql-stat-lbl">Still needed</span></div>
        <div class="ql-stat"><span class="ql-stat-val">${coverage.cellsFilled}/${coverage.cellsTotal}</span><span class="ql-stat-lbl">Cells ≥${FIT_TARGET.minPerCell}</span></div>
      </div>

      <p class="ql-target-note">
        Honest target: <strong>${FIT_TARGET.totalStrong}</strong> quotes (~${FIT_TARGET.perPeriod}/period, each preset × period at least <strong>${FIT_TARGET.minPerCell}×</strong>).
        Stretch <strong>${FIT_TARGET.totalNearPerfect}</strong>. The old “9 per period” bar was too thin for SafeBoda noise.
        Now: <strong>${escapeHtml(nowPeriod.label)}</strong> (${escapeHtml(nowPeriod.hint)}).
      </p>

      <ol class="ql-howto">
        <li>Same pickup every time: Prisca Honey / Aryan Hostel Nkinzi Rd.</li>
        <li>Pick a red preset <em>or</em> search a custom place (Pine Valley, Ganda Rd, …).</li>
        <li>In SafeBoda, set that exact drop-off and copy the fee here within this time band.</li>
        <li>Best signal: log the <em>same</em> route again in a different period (day vs evening vs night).</li>
      </ol>

      <div class="ql-periods">${buildPeriodBars(coverage)}</div>

      ${nextHtml}

      <div class="ql-origin">
        <span class="ql-origin-label">Pickup (locked)</span>
        <span class="ql-origin-val">${escapeHtml(BASE_ORIGIN.label)}</span>
      </div>

      <div class="ql-label">Drop-off presets</div>
      <div class="ql-chips" id="quoteLabChips">${buildDropChips(coverage)}</div>

      <div class="ql-label">Custom / calibration search</div>
      <div class="ql-calib-row">${calibrationHintsHtml()}</div>
      <div class="ql-custom${customSelected ? ' is-active' : ''}" id="quoteLabCustomWrap">
        ${deliveryPlaceFieldMarkup({
          inputId: 'quoteLabCustomInput',
          dropdownId: 'quoteLabCustomDropdown',
          value: customDrop?.label || '',
          placeholder: 'Search any SafeBoda drop-off…',
        })}
      </div>

      <div class="ql-metrics" id="quoteLabMetrics">${metricsLineHtml(seedMetrics)}</div>
      <div class="ql-predict" id="quoteLabPredict">${escapeHtml(predictLineText(seedMetrics))}</div>

      <label class="ql-fee-label" for="quoteLabFee">SafeBoda fee (UGX)</label>
      <div class="ql-fee-row">
        <span class="ql-fee-icon">${ICON_CASH}</span>
        <input type="text" inputmode="numeric" pattern="[0-9]*" id="quoteLabFee" class="ql-fee-input" placeholder="e.g. 5500" autocomplete="off" value="${escapeHtml(feeDraft)}" />
        <button type="button" class="ql-btn primary ql-save-btn${saving ? ' is-saving' : ''}" id="quoteLabSave" ${saving ? 'disabled' : ''} aria-busy="${saving ? 'true' : 'false'}">
          <span class="ql-save-idle">Log quote</span>
          <span class="ql-save-busy">Saving…</span>
        </button>
      </div>
      <p class="ql-help">Log inside the current time band so the period counts. Re-logging the same place across periods teaches peak/night premiums better than new random drops.</p>

      ${reminderStatusHtml()}
    </section>`;

  wireQuoteLabDom();
  if (drop?.lat != null) computeRouteMetrics(drop);

  // Hash deep-link only — skip after save/re-render so mobile doesn't jump.
  if (location.hash === '#quote-lab' && !didScrollToLab) {
    didScrollToLab = true;
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function wireQuoteLabDom() {
  const chips = document.getElementById('quoteLabChips');
  chips?.querySelectorAll('[data-drop]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDropId = btn.dataset.drop;
      customDrop = null;
      feeDraft = '';
      const feeInput = document.getElementById('quoteLabFee');
      if (feeInput) feeInput.value = '';
      chips.querySelectorAll('.ql-chip').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('quoteLabCustomWrap')?.classList.remove('is-active');
      computeRouteMetrics(getDropoffById(selectedDropId));
    });
  });

  document.querySelectorAll('[data-calib-search]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDropId = 'custom';
      customDrop = null;
      routeMetrics = null;
      const input = document.getElementById('quoteLabCustomInput');
      if (input) {
        input.value = btn.dataset.calibSearch || '';
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.getElementById('quoteLabCustomWrap')?.classList.add('is-active');
      chips?.querySelectorAll('.ql-chip').forEach((c) => c.classList.remove('selected'));
      updateMetricsReadout();
    });
  });

  wireSinglePlaceAutocomplete('quoteLabCustomInput', 'quoteLabCustomDropdown', {
    onSelect: (place) => {
      const lat = place?.lat ?? place?.geometry?.location?.lat?.();
      const lng = place?.lng ?? place?.geometry?.location?.lng?.();
      const label =
        place?.label ||
        place?.formattedAddress ||
        place?.formatted_address ||
        place?.name ||
        document.getElementById('quoteLabCustomInput')?.value ||
        'Custom drop';
      if (lat == null || lng == null || Number.isNaN(Number(lat))) {
        showToast('Could not pin that place — pick another suggestion', true);
        return;
      }
      selectedDropId = 'custom';
      customDrop = {
        id: 'custom',
        label: String(label),
        shortLabel: String(label).split(',')[0].trim() || 'Custom',
        lat: Number(lat),
        lng: Number(lng),
      };
      chips?.querySelectorAll('.ql-chip').forEach((c) => c.classList.remove('selected'));
      document.getElementById('quoteLabCustomWrap')?.classList.add('is-active');
      computeRouteMetrics(customDrop);
    },
  });

  document.getElementById('quoteLabFee')?.addEventListener('input', (e) => {
    feeDraft = e.target.value;
  });

  document.getElementById('quoteLabSave')?.addEventListener('click', () => void saveTestQuote());

  document.getElementById('quoteLabEnableNotif')?.addEventListener('click', async () => {
    const perm = await ensureNotificationPermission();
    if (perm === 'granted') {
      setNotificationPrefs({ schedulesEnabled: true });
      setLocalSchedules(DELIVERY_TEST_REMINDERS);
      const push = await subscribeWebPush({ schedulesEnabled: true });
      if (push.ok) {
        showToast('Push reminders on — work with browser closed');
      } else if (push.reason === 'unsupported') {
        showToast('Reminders on while POS is open (this browser has no Web Push)');
      } else {
        showToast('Reminders on while open — push registration failed', true);
      }
    } else if (perm === 'denied') {
      showToast('Notifications blocked — in-app banners still work', true);
    }
    renderQuoteLab();
  });

  document.getElementById('quoteLabToggleSched')?.addEventListener('click', async () => {
    const prefs = getNotificationPrefs();
    const next = !prefs.schedulesEnabled;
    setNotificationPrefs({ schedulesEnabled: next });
    if (prefs.pushSubscribed) {
      await syncWebPushPrefs({ schedulesEnabled: next });
    } else if (next) {
      const push = await subscribeWebPush({ schedulesEnabled: true });
      if (push.ok) showToast('Push reminders on — work with browser closed');
      else showToast('Reminders resumed (open-tab only)');
      renderQuoteLab();
      return;
    }
    showToast(next ? 'Reminders resumed' : 'Reminders paused');
    renderQuoteLab();
  });

  document.getElementById('quoteLabTestNotif')?.addEventListener('click', async () => {
    await ensureNotificationPermission();
    await showAppNotification({
      type: 'delivery-test',
      title: 'Venus · quote lab',
      body: 'Test reminder — when this fires for real, open SafeBoda and log a preset route.',
      tag: 'dl-test-ping',
      requireInteraction: false,
      inApp: true,
    });
  });
}

async function saveTestQuote() {
  const drop = activeDrop();
  const feeVal = parseInt(String(feeDraft).replace(/[^\d]/g, ''), 10);
  if (!drop || drop.lat == null) {
    showToast('Pick a preset or search a custom drop-off first', true);
    return;
  }
  if (!routeMetrics) {
    showToast('Wait for distance to calculate', true);
    return;
  }
  if (!feeVal || feeVal <= 0) {
    showToast('Enter the SafeBoda fee from the app', true);
    return;
  }
  if (saving) return;

  saving = true;
  setSaveButtonSaving(true);

  const model = liveModel();
  const predicted = predictSafeBodaFee(routeMetrics.km, model, {
    durationMin: routeMetrics.mins,
    at: new Date(),
  });

  const payload = {
    client_id: null,
    client_name: TEST_CLIENT_NAME,
    sale_id: null,
    origin_lat: BASE_ORIGIN.lat,
    origin_lng: BASE_ORIGIN.lng,
    origin_label: BASE_ORIGIN.label,
    dest_lat: drop.lat,
    dest_lng: drop.lng,
    dest_label: drop.label,
    distance_km: Number(routeMetrics.km.toFixed(3)),
    duration_min: Number(routeMetrics.mins.toFixed(1)),
    fee_ugx: feeVal,
    predicted_fee_ugx: predicted,
    fee_was_edited: predicted != null ? feeVal !== predicted : null,
  };

  try {
    const res = await sbFetch('deliveries', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();

    feeDraft = '';
    selectedDropId = null;
    customDrop = null;
    // Clear before appendDelivery → notify → renderQuoteLab, or the button
    // paints stuck on "Saving…" with saving still true.
    saving = false;
    if (rows[0]) await dataStore.appendDelivery(rows[0]);
    else renderQuoteLab();

    showToast(`Logged ${fmtUGX(feeVal)} · ${drop.shortLabel || drop.label}`);
  } catch (e) {
    console.error('quote lab save failed', e);
    showToast('Could not log quote', true);
    saving = false;
    setSaveButtonSaving(false);
  } finally {
    saving = false;
  }
}

/** Call once from Delivery page — quote lab UI only (push runtime boots in app.js). */
export function initQuoteLabReminders() {
  if (labWired) return;
  labWired = true;
  // Keep local schedules registered if Delivery is the first page visited.
  startNotificationRuntime(DELIVERY_TEST_REMINDERS);
}

export { isTestQuote };
