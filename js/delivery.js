import { sbFetch } from './api.js';
import { GOOGLE_MAPS_API_KEY } from './config.js';
import { deliveries } from './state.js';
import { fmtUGX, showToast } from './utils.js';
import { logDebug } from './debug.js';

let gmapsLoaded = false;
let gmapsLoading = false;

export function loadGoogleMaps(cb) {
  if (gmapsLoaded && window.google) {
    cb();
    return;
  }
  window.__venusGmapsQueue = window.__venusGmapsQueue || [];
  window.__venusGmapsQueue.push(cb);
  if (gmapsLoading) return;
  gmapsLoading = true;
  window.__venusGmapsReady = () => {
    gmapsLoaded = true;
    gmapsLoading = false;
    window.__venusGmapsQueue.forEach((fn) => fn());
    window.__venusGmapsQueue = [];
  };
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=__venusGmapsReady`;
  script.async = true;
  script.onerror = () => {
    gmapsLoading = false;
    logDebug('Google Maps script failed to load.');
    showToast('Could not load Google Maps — check the API key', true);
  };
  document.head.appendChild(script);
}

export const ICON_LOCATE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.5v3.6M12 17.9v3.6M2.5 12h3.6M17.9 12h3.6"></path></svg>`;
export const ICON_PIN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.2s7.2-6.8 7.2-12.4a7.2 7.2 0 1 0-14.4 0c0 5.6 7.2 12.4 7.2 12.4z"></path><circle cx="12" cy="8.8" r="2.4"></circle></svg>`;
export const ICON_CASH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.3" y="6.2" width="19.4" height="11.6" rx="2.1"></rect><circle cx="12" cy="12" r="2.7"></circle><path d="M6 9.4v.01M18 14.6v.01"></path></svg>`;
export const ICON_ROUTE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"></circle><circle cx="18" cy="18" r="2.4"></circle><path d="M6 8.4v4.2a3.4 3.4 0 0 0 3.4 3.4h5.2"></path></svg>`;

export async function loadDeliveries() {
  try {
    const res = await sbFetch('deliveries?select=*&order=created_at.desc&limit=500');
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    deliveries.length = 0;
    deliveries.push(...rows);
  } catch (e) {
    console.error('load deliveries failed', e);
    showToast('Could not load delivery history', true);
  }
  renderDeliveryAnalysis();
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  points.forEach((p) => {
    ssXY += (p.x - meanX) * (p.y - meanY);
    ssXX += (p.x - meanX) ** 2;
    ssYY += (p.y - meanY) ** 2;
  });
  if (ssXX === 0) return null;
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r2 = ssYY === 0 ? 1 : (ssXY * ssXY) / (ssXX * ssYY);
  return { slope, intercept, r2, n };
}

function buildDeliveryScatterSVG(points, reg) {
  const w = 320;
  const h = 190;
  const pad = 30;
  const maxX = Math.max(...points.map((p) => p.x)) * 1.15 || 1;
  const maxY = Math.max(...points.map((p) => p.y)) * 1.15 || 1;
  const sx = (x) => pad + (x / maxX) * (w - pad * 2);
  const sy = (y) => h - pad - (Math.max(0, y) / maxY) * (h - pad * 2);
  const dots = points
    .map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="var(--jade)" />`)
    .join('');
  const lineY0 = reg.intercept;
  const lineY1 = reg.intercept + reg.slope * maxX;
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; display:block;" role="img" aria-label="Delivery fee scatter plot">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--panel-edge)" stroke-width="1" />
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="var(--panel-edge)" stroke-width="1" />
    <line x1="${sx(0).toFixed(1)}" y1="${sy(lineY0).toFixed(1)}" x2="${sx(maxX).toFixed(1)}" y2="${sy(lineY1).toFixed(1)}" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="4 3" />
    ${dots}
    <text x="${pad}" y="${h - 8}" font-size="9" fill="var(--text-dim)" font-family="DM Mono, monospace">0 km</text>
    <text x="${w - pad}" y="${h - 8}" font-size="9" fill="var(--text-dim)" text-anchor="end" font-family="DM Mono, monospace">${maxX.toFixed(1)} km</text>
  </svg>`;
}

export function renderDeliveryAnalysis() {
  const statsEl = document.getElementById('deliveryStats');
  const scatterEl = document.getElementById('deliveryScatter');
  const listEl = document.getElementById('deliveryLogList');
  if (!statsEl) return;

  const points = deliveries
    .map((d) => ({ x: Number(d.distance_km), y: Number(d.fee_ugx) }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y));
  const reg = linearRegression(points);

  if (!reg) {
    statsEl.innerHTML = `<div class="stat-card"><div class="val">—</div><div class="lbl">Log 2+ deliveries to fit a model</div></div>`;
    if (scatterEl) scatterEl.innerHTML = '';
  } else {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="val">${fmtUGX(Math.round(reg.intercept))}</div><div class="lbl">Estimated base fee</div></div>
      <div class="stat-card"><div class="val">${fmtUGX(Math.round(reg.slope))}</div><div class="lbl">Estimated per-km rate</div></div>
      <div class="stat-card"><div class="val">${reg.r2.toFixed(3)}</div><div class="lbl">R² fit · ${reg.n} trips</div></div>
    `;
    if (scatterEl) scatterEl.innerHTML = buildDeliveryScatterSVG(points, reg);
  }

  if (!listEl) return;
  if (deliveries.length === 0) {
    listEl.innerHTML = `<div class="client-empty">No deliveries logged yet</div>`;
  } else {
    listEl.innerHTML = deliveries
      .slice(0, 40)
      .map((d) => {
        const dt = new Date(d.created_at);
        const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const who = d.client_name || d.dest_label || 'Delivery';
        return `<div class="delivery-log-row">
          <span>${dateStr} · ${who}</span>
          <span class="dl-dist">${Number(d.distance_km).toFixed(1)} km</span>
          <span class="dl-fee">${fmtUGX(d.fee_ugx)}</span>
        </div>`;
      })
      .join('');
  }
}
