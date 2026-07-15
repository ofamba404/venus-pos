import { sbFetch } from './api.js';
import { dataStore } from './store/index.js';
import { animateModalContent, isModalOpen, wireHeaderBodyAccordions } from './animations.js';
import { clientAutocompleteMarkup, wireClientAutocomplete } from './client-autocomplete.js';
import {
  deliveryPlaceFieldMarkup,
  loadGoogleMaps,
  setDeliveryFieldValue,
  wireDeliveryPlacesInputs,
} from './places-autocomplete.js';
import { deliveries } from './state.js';
import {
  closeEditModal,
  escapeHtml,
  fmtCompact,
  fmtUGX,
  isToday,
  openEditModal,
  showConfirm,
  showToast,
} from './utils.js';
import {
  deliveryLogPlaceholder,
  deliveryModelPlaceholder,
  showPlaceholder,
} from './pending.js';
import {
  estimateDurationMin,
  fitDeliveryFeeModel,
  formatPremiumVsDay,
  listPeriods,
  modelConfidence,
  periodForDate,
  periodMeta,
  predictSafeBodaFee as predictFromModel,
  quoteFee,
} from './delivery-fee-model.js';

let editingDeliveryId = null;
let editOrigin = null;
let editPickupText = '';
let editDest = null;
let editDestText = '';
let editDistanceKm = null;
let editDurationMin = null;
let editFeeValue = '';
let editClientName = '';
export { loadGoogleMaps } from './places-autocomplete.js';

export const ICON_LOCATE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.5v3.6M12 17.9v3.6M2.5 12h3.6M17.9 12h3.6"></path></svg>`;
export const ICON_PIN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.2s7.2-6.8 7.2-12.4a7.2 7.2 0 1 0-14.4 0c0 5.6 7.2 12.4 7.2 12.4z"></path><circle cx="12" cy="8.8" r="2.4"></circle></svg>`;
export const ICON_CASH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.3" y="6.2" width="19.4" height="11.6" rx="2.1"></rect><circle cx="12" cy="12" r="2.7"></circle><path d="M6 9.4v.01M18 14.6v.01"></path></svg>`;
export const ICON_ROUTE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"></circle><circle cx="18" cy="18" r="2.4"></circle><path d="M6 8.4v4.2a3.4 3.4 0 0 0 3.4 3.4h5.2"></path></svg>`;

export function restoreDeliveriesFromCache() {
  return dataStore.hasData('deliveries');
}

export async function loadDeliveries() {
  await dataStore.fetch('deliveries');
}

export function getDeliveryFeeModel() {
  return fitDeliveryFeeModel(deliveries);
}

/**
 * Predicted SafeBoda fee for a route, or null if the model isn't ready yet.
 * @param {number} km
 * @param {{ durationMin?: number|null, period?: string|null, at?: Date|string|null, model?: object|null }} [opts]
 */
export function predictSafeBodaFee(km, opts = {}) {
  const model = opts.model ?? getDeliveryFeeModel();
  return predictFromModel(km, model, opts);
}

function buildDeliveryScatterSVG(model) {
  const points = (model.samples || []).map((s) => ({
    x: s.km,
    y: s.fee,
    period: s.period,
  }));
  if (!points.length) return '';

  const w = 360;
  const h = 200;
  const pad = { t: 20, r: 16, b: 36, l: 44 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const maxX = Math.max(...points.map((p) => p.x), 1) * 1.12;
  const maxY = Math.max(...points.map((p) => p.y), 1) * 1.12;
  const sx = (x) => pad.l + (x / maxX) * innerW;
  const sy = (y) => pad.t + innerH - (Math.max(0, y) / maxY) * innerH;

  const grid = [0, 0.5, 1]
    .map((pct) => {
      const y = pad.t + innerH * (1 - pct);
      const val = maxY * pct;
      return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" class="dl-grid-line"/>
        <text x="${pad.l - 6}" y="${y + 3}" class="dl-axis-label" text-anchor="end">${fmtCompact(val)}</text>`;
    })
    .join('');

  const dots = points
    .map((p) => {
      const meta = periodMeta(p.period);
      return `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="5" class="dl-scatter-dot period-${p.period}">
          <title>${p.x.toFixed(1)} km · ${meta.label} → ${fmtUGX(p.y)}</title>
        </circle>`;
    })
    .join('');

  const lineY0 = model.intercept;
  const lineY1 = model.intercept + model.slope * maxX;
  const fitLabel = `R² ${model.r2.toFixed(2)}`;

  return `<svg class="dl-scatter-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Delivery fee vs distance scatter plot">
    ${grid}
    <line x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}" class="dl-axis-line"/>
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" class="dl-axis-line"/>
    <line x1="${sx(0).toFixed(1)}" y1="${sy(lineY0).toFixed(1)}" x2="${sx(maxX).toFixed(1)}" y2="${sy(lineY1).toFixed(1)}" class="dl-trend-line"/>
    ${dots}
    <text x="${pad.l}" y="${h - 10}" class="dl-axis-label">0 km</text>
    <text x="${w - pad.r}" y="${h - 10}" class="dl-axis-label" text-anchor="end">${maxX.toFixed(1)} km</text>
    <text x="${w - pad.r}" y="${pad.t - 4}" class="dl-fit-label" text-anchor="end">${fitLabel}</text>
  </svg>`;
}

function buildReferenceTable(model, period) {
  const distances = [1, 2, 3, 5, 8, 10];
  return distances
    .map((km) => {
      const mins = estimateDurationMin(km, model);
      return `
    <div class="dl-ref-row">
      <span class="dl-ref-km">${km} km</span>
      <span class="dl-ref-fee">${fmtUGX(quoteFee(km, model, { durationMin: mins, period }))}</span>
    </div>`;
    })
    .join('');
}

function buildPeriodPremiumRows(model) {
  return listPeriods()
    .map((p) => {
      const n = model.periodCounts[p.id] || 0;
      const vsDay = formatPremiumVsDay(model, p.id);
      let val = '—';
      if (n >= 2 && vsDay != null) {
        if (vsDay === 0) val = '≈ day';
        else val = `${vsDay > 0 ? '+' : ''}${fmtCompact(vsDay)}`;
      } else if (n === 1) {
        val = 'need more';
      }
      return `<div class="dl-period-row">
        <span class="dl-period-name"><i class="dl-period-swatch period-${p.id}"></i>${p.label}</span>
        <span class="dl-period-meta">${p.hint} · ${n}</span>
        <span class="dl-period-val">${val}</span>
      </div>`;
    })
    .join('');
}

function renderDeliveryModel(model) {
  const el = document.getElementById('deliveryModel');
  if (!el) return;

  const sampleCount = deliveries.length;

  if (!model && showPlaceholder('deliveries', sampleCount)) {
    el.innerHTML = deliveryModelPlaceholder();
    return;
  }

  if (!model) {
    el.innerHTML = `
      <div class="dl-model-card empty">
        <div class="dl-model-icon" aria-hidden="true">${ICON_ROUTE}</div>
        <div class="dl-model-title">Decode SafeBoda pricing</div>
        <div class="dl-model-copy">Log real SafeBoda quotes at checkout — pickup, drop-off, distance, and the fee they charged. Venus fits distance, travel time, and time of day so estimates stay accurate day and night.</div>
        ${
          sampleCount > 0
            ? `<div class="dl-progress">
            <div class="dl-progress-track"><div class="dl-progress-fill" style="width:${(sampleCount / 2) * 100}%"></div></div>
            <span class="dl-progress-label">${sampleCount} of 2 samples logged</span>
          </div>`
            : `<div class="dl-formula-preview">Predicted fee ≈ <em>base</em> + (km × <em>rate</em>) + (min × <em>rate</em>) + <em>time premium</em></div>`
        }
      </div>`;
    return;
  }

  const base = Math.round(model.core.intercept);
  const kmRate = Math.round(model.core.kmRate);
  const slowdownRate =
    model.core.slowdownRate != null && model.core.slowdownRate > 0
      ? Math.round(model.core.slowdownRate)
      : null;
  const conf = modelConfidence(model);
  const nowPeriod = periodForDate(new Date());
  const defaultKm = deliveries.length ? Number(deliveries[0].distance_km) || 5 : 5;
  const defaultMins = estimateDurationMin(defaultKm, model);
  const defaultFee = quoteFee(defaultKm, model, { durationMin: defaultMins, period: nowPeriod });

  const formulaParts = [
    `<span class="dl-formula-part base">${fmtCompact(base)}</span>`,
    `<span class="dl-formula-op">+</span>`,
    `<span class="dl-formula-part">( km × </span>`,
    `<span class="dl-formula-part rate">${fmtCompact(kmRate)}</span>`,
    `<span class="dl-formula-part"> )</span>`,
  ];
  if (slowdownRate != null) {
    formulaParts.push(
      `<span class="dl-formula-op">+</span>`,
      `<span class="dl-formula-part">( slow min × </span>`,
      `<span class="dl-formula-part rate">${fmtCompact(slowdownRate)}</span>`,
      `<span class="dl-formula-part"> )</span>`,
    );
  }
  formulaParts.push(
    `<span class="dl-formula-op">+</span>`,
    `<span class="dl-formula-part">time premium</span>`,
  );

  const periodOptions = listPeriods()
    .map((p) => {
      const selected = p.id === nowPeriod ? ' selected' : '';
      return `<option value="${p.id}"${selected}>${p.label} (${p.hint})</option>`;
    })
    .join('');

  el.innerHTML = `
    <div class="dl-model-card">
      <div class="dl-model-head">
        <div>
          <div class="dl-model-title">SafeBoda pricing model</div>
          <div class="dl-model-sub">Dynamic fit from ${model.n} logged quote${model.n === 1 ? '' : 's'} · distance${model.usesDuration ? ' + traffic slowdown' : ''} + hour of day</div>
        </div>
        <span class="dl-confidence ${conf.cls}" title="${conf.label}">${conf.pct}% fit</span>
      </div>

      <div class="dl-intel">
        <div class="dl-intel-item">
          <span class="dl-intel-val">${fmtUGX(base)}</span>
          <span class="dl-intel-lbl">Est. base</span>
        </div>
        <div class="dl-intel-item">
          <span class="dl-intel-val">${fmtUGX(kmRate)}</span>
          <span class="dl-intel-lbl">Per km</span>
        </div>
        <div class="dl-intel-item">
          <span class="dl-intel-val">${slowdownRate != null ? fmtUGX(slowdownRate) : '—'}</span>
          <span class="dl-intel-lbl">Per slow min</span>
        </div>
      </div>

      <div class="dl-formula">${formulaParts.join('')}</div>

      <div class="dl-period-card">
        <div class="dl-period-title">Time-of-day premiums vs day</div>
        ${buildPeriodPremiumRows(model)}
      </div>

      <div class="dl-estimator">
        <label class="dl-estimator-label" for="deliveryEstimateKm">Predict fee for a route</label>
        <div class="dl-estimator-row">
          <input type="number" id="deliveryEstimateKm" class="dl-estimator-input" min="0" step="0.5" value="${defaultKm.toFixed(1)}" inputmode="decimal" />
          <span class="dl-estimator-unit">km</span>
          <select id="deliveryEstimatePeriod" class="dl-estimator-select" aria-label="Time of day">${periodOptions}</select>
          <span class="dl-estimator-arrow" aria-hidden="true">→</span>
          <span class="dl-estimator-result" id="deliveryEstimateFee">${fmtUGX(defaultFee)}</span>
        </div>
        <div class="dl-estimator-note" id="deliveryEstimateNote">Using ~${Math.round(defaultMins)} min travel · ${periodMeta(nowPeriod).label}</div>
      </div>

      <div class="dl-reference">
        <div class="dl-ref-title">Quick lookup · <span id="deliveryRefPeriodLabel">${periodMeta(nowPeriod).label}</span></div>
        <div id="deliveryRefTable">${buildReferenceTable(model, nowPeriod)}</div>
      </div>

      <div class="dl-scatter-wrap">${buildDeliveryScatterSVG(model)}</div>
      <div class="dl-scatter-legend">
        <span><i class="dl-legend-dot period-day"></i> Day</span>
        <span><i class="dl-legend-dot period-morning_peak"></i> AM peak</span>
        <span><i class="dl-legend-dot period-evening_peak"></i> PM peak</span>
        <span><i class="dl-legend-dot period-night"></i> Night</span>
        <span><i class="dl-legend-line"></i> Distance trend</span>
      </div>
      ${
        conf.cls === 'low'
          ? `<div class="dl-model-hint">Log quotes across day and night, and mix short vs long trips — that sharpens time premiums.</div>`
          : `<div class="dl-model-hint">SafeBoda also shifts with rain / demand — treat this as a strong estimate, then confirm in-app before dispatch.</div>`
      }
    </div>`;

  const kmInput = document.getElementById('deliveryEstimateKm');
  const periodSelect = document.getElementById('deliveryEstimatePeriod');
  const feeEl = document.getElementById('deliveryEstimateFee');
  const noteEl = document.getElementById('deliveryEstimateNote');
  const refTable = document.getElementById('deliveryRefTable');
  const refLabel = document.getElementById('deliveryRefPeriodLabel');

  const refreshEstimate = () => {
    const km = parseFloat(kmInput?.value);
    const period = periodSelect?.value || nowPeriod;
    const mins = estimateDurationMin(km, model);
    if (feeEl) feeEl.textContent = fmtUGX(quoteFee(km, model, { durationMin: mins, period }));
    if (noteEl && !Number.isNaN(km)) {
      noteEl.textContent = `Using ~${Math.round(mins || 0)} min travel · ${periodMeta(period).label}`;
    }
    if (refTable) refTable.innerHTML = buildReferenceTable(model, period);
    if (refLabel) refLabel.textContent = periodMeta(period).label;
  };

  kmInput?.addEventListener('input', refreshEstimate);
  periodSelect?.addEventListener('change', refreshEstimate);
}

function renderDeliveryLog(model) {
  const listEl = document.getElementById('deliveryLogList');
  if (!listEl) return;

  if (deliveries.length === 0 && showPlaceholder('deliveries')) {
    listEl.innerHTML = deliveryLogPlaceholder();
    return;
  }

  if (deliveries.length === 0) {
    listEl.innerHTML = `<div class="receipt-empty">No quotes logged yet — at checkout, add pickup, drop-off, and the SafeBoda fee you were charged</div>`;
    return;
  }

  const dayMap = new Map();
  deliveries.forEach((d) => {
    const key = new Date(d.created_at).toDateString();
    if (!dayMap.has(key)) dayMap.set(key, { dateObj: new Date(d.created_at), trips: [] });
    dayMap.get(key).trips.push(d);
  });
  const dayGroups = Array.from(dayMap.values()).sort((a, b) => b.dateObj - a.dateObj);

  listEl.innerHTML = dayGroups
    .map((group, gIdx) => {
      const isTodayGroup = isToday(group.dateObj);
      const dayLabel = isTodayGroup
        ? 'Today'
        : group.dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

      const rows = group.trips
        .map((d) => {
          const who = d.client_name || 'No client';
          const pickup = d.origin_label || 'Pickup';
          const dropoff = d.dest_label || 'Drop-off';
          const km = Number(d.distance_km);
          const fee = Number(d.fee_ugx);
          const dur = d.duration_min != null ? Math.round(Number(d.duration_min)) : null;
          const tripPeriod = d.created_at ? periodForDate(new Date(d.created_at)) : 'day';
          const periodLabel = periodMeta(tripPeriod).short;
          const effectiveKm = km > 0 ? Math.round(fee / km) : null;
          let modelNote = '';
          if (model && km > 0) {
            const predicted = quoteFee(km, model, {
              durationMin: d.duration_min != null ? Number(d.duration_min) : null,
              period: tripPeriod,
            });
            const diff = fee - predicted;
            if (Math.abs(diff) <= 250) modelNote = '<span class="dl-trip-match">on model</span>';
            else modelNote = `<span class="dl-trip-diff ${diff > 0 ? 'over' : 'under'}">${diff > 0 ? '+' : ''}${fmtCompact(diff)} vs model</span>`;
          }
          const meta = `${!isNaN(km) ? `${km.toFixed(1)} km` : '—'}${effectiveKm != null ? ` · ${fmtUGX(effectiveKm)}/km` : ''}${dur != null ? ` · ~${dur} min` : ''} · ${periodLabel}`;

          return `<button class="delivery-trip" type="button" data-edit-delivery="${d.id}">
            <div class="delivery-trip-route" aria-hidden="true">
              <span class="delivery-trip-dot pickup"></span>
              <span class="delivery-trip-line"></span>
              <span class="delivery-trip-dot dropoff"></span>
            </div>
            <div class="delivery-trip-body">
              <div class="delivery-trip-top">
                <span class="delivery-trip-who">${escapeHtml(who)}</span>
                <span class="delivery-trip-fee">${fmtUGX(d.fee_ugx)}</span>
              </div>
              <div class="delivery-trip-meta">${meta} ${modelNote}</div>
              <div class="delivery-trip-addresses">
                <span class="delivery-trip-addr pickup">${escapeHtml(pickup)}</span>
                <span class="delivery-trip-addr dropoff">${escapeHtml(dropoff)}</span>
              </div>
            </div>
          </button>`;
        })
        .join('');

      return `
        <div class="delivery-day-group">
          <button class="delivery-day-header ${isTodayGroup ? 'expanded' : ''}" type="button" data-dl-day="${gIdx}">
            <span>${dayLabel} <span class="day-meta">(${group.trips.length} quote${group.trips.length === 1 ? '' : 's'})</span></span>
            <span class="delivery-day-right">
              <span class="day-caret">▸</span>
            </span>
          </button>
          <div class="delivery-day-body" data-dl-body="${gIdx}">
            ${rows}
          </div>
        </div>`;
    })
    .join('');

  wireHeaderBodyAccordions(listEl, { headerSelector: '.delivery-day-header' });

  listEl.querySelectorAll('[data-edit-delivery]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditDelivery(btn.dataset.editDelivery);
    });
  });
}

export function renderDeliveryAnalysis() {
  const model = getDeliveryFeeModel();
  renderDeliveryModel(model);
  renderDeliveryLog(model);
}

function updateEditDistanceReadout() {
  const fields = document.querySelector('#editModalBody .delivery-mini');
  if (!fields) return;
  let readout = fields.querySelector('.delivery-mini-readout');
  if (editDistanceKm != null) {
    const html = `${ICON_ROUTE} ${editDistanceKm.toFixed(1)} km · ~${Math.round(editDurationMin)} min`;
    if (readout) readout.innerHTML = html;
    else {
      readout = document.createElement('div');
      readout.className = 'delivery-mini-readout';
      readout.innerHTML = html;
      const feeWrap = fields.querySelector('.delivery-input-wrap.fee');
      if (feeWrap) feeWrap.insertAdjacentElement('afterend', readout);
      else fields.appendChild(readout);
    }
  } else if (readout) {
    readout.remove();
  }
}

function computeEditDistance() {
  if (!editOrigin || !editDest) {
    editDistanceKm = null;
    return;
  }
  loadGoogleMaps(() => {
    const service = new google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      {
        origins: [editOrigin],
        destinations: [editDest],
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (res, status) => {
        if (status === 'OK' && res.rows[0].elements[0].status === 'OK') {
          const el = res.rows[0].elements[0];
          editDistanceKm = el.distance.value / 1000;
          editDurationMin = el.duration.value / 60;
        } else {
          editDistanceKm = null;
          editDurationMin = null;
        }
        updateEditDistanceReadout();
      },
    );
  });
}

function openEditDelivery(id) {
  const d = deliveries.find((row) => row.id === id);
  if (!d) return;

  editingDeliveryId = id;
  editOrigin = d.origin_lat != null && d.origin_lng != null ? { lat: d.origin_lat, lng: d.origin_lng } : null;
  editPickupText = d.origin_label || '';
  editDest = d.dest_lat != null && d.dest_lng != null ? { lat: d.dest_lat, lng: d.dest_lng } : null;
  editDestText = d.dest_label || '';
  editDistanceKm = d.distance_km != null ? Number(d.distance_km) : null;
  editDurationMin = d.duration_min != null ? Number(d.duration_min) : null;
  editFeeValue = d.fee_ugx != null ? String(d.fee_ugx) : '';
  editClientName = d.client_name || '';

  renderEditDeliveryModal();
  openEditModal();
}

function renderEditDeliveryModal() {
  const body = document.getElementById('editModalBody');
  if (!body) return;

  body.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="editModalTitle">Edit delivery</div>
      <button class="modal-close" id="editDeliveryClose" type="button">✕</button>
    </div>
    <div class="client-picker">
      <label>Client name</label>
      ${clientAutocompleteMarkup({
        inputId: 'editDeliveryClient',
        dropdownId: 'editDeliveryClientDropdown',
        clearId: 'editDeliveryClientClear',
        value: editClientName,
        placeholder: 'Client (optional)',
      })}
    </div>
    <div class="delivery-mini">
      <div class="delivery-mini-label">Route</div>
      <div class="delivery-input-wrap pickup">
        ${deliveryPlaceFieldMarkup({
          inputId: 'editDeliveryPickup',
          dropdownId: 'editDeliveryPickupDropdown',
          placeholder: 'Pickup location',
          value: editPickupText,
          icon: ICON_LOCATE,
        })}
      </div>
      <div class="delivery-input-wrap dropoff">
        ${deliveryPlaceFieldMarkup({
          inputId: 'editDeliveryDest',
          dropdownId: 'editDeliveryDestDropdown',
          placeholder: 'Drop-off location',
          value: editDestText,
          icon: ICON_PIN,
        })}
      </div>
      <div class="delivery-input-wrap fee">
        <span class="di-icon">${ICON_CASH}</span>
        <input type="text" inputmode="numeric" pattern="[0-9]*" class="client-input" id="editDeliveryFee" placeholder="SafeBoda fee (UGX)" autocomplete="off" value="${escapeHtml(editFeeValue)}" />
      </div>
      ${editDistanceKm != null ? `<div class="delivery-mini-readout">${ICON_ROUTE} ${editDistanceKm.toFixed(1)} km · ~${Math.round(editDurationMin)} min</div>` : ''}
    </div>
    <div class="modal-btns">
      <button class="modal-btn cancel" id="editDeliveryDelete" type="button">Delete</button>
      <button class="modal-btn cancel" id="editDeliveryCancel" type="button">Cancel</button>
      <button class="modal-btn confirm" id="editDeliverySave" type="button">Save</button>
    </div>`;

  if (isModalOpen(document.getElementById('editOverlay'))) animateModalContent(body);

  document.getElementById('editDeliveryClose')?.addEventListener('click', closeEditModal);
  document.getElementById('editDeliveryCancel')?.addEventListener('click', closeEditModal);

  wireDeliveryPlacesInputs(
    'editDeliveryPickup',
    'editDeliveryPickupDropdown',
    'editDeliveryDest',
    'editDeliveryDestDropdown',
    {
    onPickupSelect: ({ lat, lng, label }) => {
      editOrigin = { lat, lng };
      editPickupText = label;
      setDeliveryFieldValue('editDeliveryPickup', label);
      computeEditDistance();
    },
    onDestSelect: ({ lat, lng, label }) => {
      editDest = { lat, lng };
      editDestText = label;
      setDeliveryFieldValue('editDeliveryDest', label);
      computeEditDistance();
    },
    onPickupInput: (value) => {
      editPickupText = value;
      if (!value) {
        editOrigin = null;
        editDistanceKm = null;
        updateEditDistanceReadout();
      }
    },
    onDestInput: (value) => {
      editDestText = value;
      if (!value) {
        editDest = null;
        editDistanceKm = null;
        updateEditDistanceReadout();
      }
    },
  });

  document.getElementById('editDeliveryFee')?.addEventListener('input', (e) => {
    editFeeValue = e.target.value;
  });
  wireClientAutocomplete({
    inputId: 'editDeliveryClient',
    dropdownId: 'editDeliveryClientDropdown',
    clearId: 'editDeliveryClientClear',
    onChange: (name) => {
      editClientName = name;
    },
  });

  document.getElementById('editDeliverySave')?.addEventListener('click', saveDeliveryEdit);
  document.getElementById('editDeliveryDelete')?.addEventListener('click', deleteDelivery);
}

async function saveDeliveryEdit() {
  if (!editingDeliveryId) return;

  const feeVal = parseInt(editFeeValue, 10);
  if (!editOrigin || !editDest || editDistanceKm == null || !feeVal || feeVal <= 0) {
    showToast('Set pickup, drop-off, and fee before saving', true);
    return;
  }

  const payload = {
    client_name: editClientName.trim() || null,
    origin_lat: editOrigin.lat,
    origin_lng: editOrigin.lng,
    origin_label: editPickupText || null,
    dest_lat: editDest.lat,
    dest_lng: editDest.lng,
    dest_label: editDestText || null,
    distance_km: Number(editDistanceKm.toFixed(3)),
    duration_min: editDurationMin != null ? Number(editDurationMin.toFixed(1)) : null,
    fee_ugx: feeVal,
  };

  try {
    const res = await sbFetch(`deliveries?id=eq.${editingDeliveryId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);

    const idx = deliveries.findIndex((d) => d.id === editingDeliveryId);
    if (idx > -1) Object.assign(deliveries[idx], payload);

    await dataStore.persistCurrent('deliveries');

    editingDeliveryId = null;
    closeEditModal();
    showToast('Delivery updated');
    renderDeliveryAnalysis();
  } catch (e) {
    console.error('save delivery failed', e);
    showToast('Could not save delivery', true);
  }
}

async function deleteDelivery() {
  if (!editingDeliveryId) return;
  const deliveryId = editingDeliveryId;
  editingDeliveryId = null;
  closeEditModal();

  const ok = await showConfirm('Delete this delivery record?');
  if (!ok) return;

  try {
    const res = await sbFetch(`deliveries?id=eq.${deliveryId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);

    const idx = deliveries.findIndex((d) => d.id === deliveryId);
    if (idx > -1) deliveries.splice(idx, 1);

    await dataStore.persistCurrent('deliveries');

    showToast('Delivery deleted');
    renderDeliveryAnalysis();
  } catch (e) {
    console.error('delete delivery failed', e);
    showToast('Could not delete delivery', true);
  }
}
