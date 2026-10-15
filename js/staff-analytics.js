/**
 * Staff-only pages (pos_staff). Admin never loads this module.
 *   - Analytics: full commission details + analytics of the signed-in staff member's OWN sales.
 *   - Delivery: own delivery history only (no pricing model / quote tools).
 * Data is RLS-scoped server-side; we also filter by seller/deliverer id client-side as defence.
 */
import { sbFetch } from './api.js';
import { CAT_MAP, PRODUCTS, COOKIE_OWNER_SHARE, isCookieCategoryId } from './config.js';
import { deliveries, salesCache } from './state.js';
import { escapeHtml, fmtCompact, fmtUGX } from './utils.js';

const KAMPALA = 'Africa/Kampala';

function myId() {
  return window.VenusPosAuth?.getUserId?.() || null;
}

export function mySales() {
  const id = myId();
  return (salesCache || []).filter((s) => !id || !s.seller_id || s.seller_id === id);
}

function myDeliveries() {
  const id = myId();
  return (deliveries || []).filter((d) => !id || !d.delivered_by || d.delivered_by === id);
}

async function getJson(path) {
  const res = await sbFetch(path);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function kampalaDayKey(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: KAMPALA });
}

function unitsOfSale(s) {
  let joints = 0;
  let cookies = 0;
  for (const it of Array.isArray(s.items) ? s.items : []) {
    for (const [k, v] of Object.entries(it?.breakdown || {})) {
      const n = Number(v) || 0;
      if (isCookieCategoryId(k)) cookies += n;
      else joints += n;
    }
  }
  return { joints, cookies };
}

function stat(label, value, sub = '') {
  return `<div class="sa-stat"><div class="sa-stat__val">${value}</div><div class="sa-stat__lbl">${label}</div>${sub ? `<div class="sa-stat__sub">${sub}</div>` : ''}</div>`;
}

function barChart(rows, { fmt = (v) => String(v) } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="sa-bars">${rows
    .map(
      (r) => `<div class="sa-bar"><div class="sa-bar__track"><div class="sa-bar__fill" style="height:${Math.round((r.value / max) * 100)}%"></div></div><div class="sa-bar__val">${r.value ? fmt(r.value) : ''}</div><div class="sa-bar__lbl">${escapeHtml(r.label)}</div></div>`,
    )
    .join('')}</div>`;
}

function hbars(rows, fmt = (v) => String(v)) {
  if (!rows.length) return '<p class="sa-empty">No sales yet.</p>';
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="sa-hbars">${rows
    .map(
      (r) => `<div class="sa-hbar"><span class="sa-hbar__lbl">${r.color ? `<i style="background:${r.color}"></i>` : ''}${escapeHtml(r.label)}</span><span class="sa-hbar__track"><span style="width:${Math.round((r.value / max) * 100)}%"></span></span><span class="sa-hbar__val">${fmt(r.value)}</span></div>`,
    )
    .join('')}</div>`;
}

/** Commission per item at list price, from DB costs (joint_costs / cookie_costs). */
function rateTable(rate, jointCosts, cookieCosts, ownerShare) {
  const jc = Object.fromEntries((jointCosts || []).map((r) => [r.category_id, Number(r.cost_ugx)]));
  const cc = Object.fromEntries((cookieCosts || []).map((r) => [r.category_id, Number(r.wholesale_ugx)]));
  const flavoredJoint = Math.max(0, ...['mint', 'strawberry', 'blueberry', 'watermelon', 'grape', 'coconut', 'melon'].map((k) => jc[k] || 0));
  const plain = jc.classic ?? 0;
  const spliff = jc.spliff7030 ?? 0;
  const joint = (price, cost) => Math.round(Math.max(price - cost, 0) * rate);
  const cookie = (price, cost) => Math.round(Math.max(price - cost, 0) * ownerShare * rate);
  const fc = cc.cookie_chocolate ?? 3000;
  const bc = cc.cookie_butterscotch ?? 2500;
  const rows = [];
  for (const p of PRODUCTS) {
    if (p.id === 'cookie_wholesale') continue;
    if (p.id === 'variety') rows.push([p.name, p.price, joint(p.price, plain + (p.joints - 1) * flavoredJoint)]);
    else if (['scout', 'pilot', 'commander'].includes(p.id)) rows.push([p.name, p.price, joint(p.price, p.joints * flavoredJoint)]);
    else if (p.id === 'plain_single') rows.push([p.name, p.unitPrice, joint(p.unitPrice, plain)]);
    else if (p.id === 'spliff_single') rows.push([`${p.name} 70/30`, p.unitPrice, joint(p.unitPrice, spliff)]);
    else if (p.id === 'cookie_duet' || p.id === 'cookie_trio') rows.push([p.name, p.price, cookie(p.price, p.joints * fc)]);
    else if (p.id === 'cookie_single') {
      rows.push(['Butterscotch cookie', 5000, cookie(5000, bc)]);
      rows.push(['Flavored cookie', 8000, cookie(8000, fc)]);
      rows.push(['Flavored cookie (4+ bulk)', 6500, cookie(6500, fc)]);
    }
  }
  return `<table class="commission-table sa-rates"><thead><tr><th>Item</th><th>Price</th><th>You earn</th></tr></thead><tbody>${rows
    .map(([n, price, c]) => `<tr><th scope="row">${escapeHtml(n)}</th><td>${fmtUGX(price)}</td><td>${fmtUGX(c)}</td></tr>`)
    .join('')}</tbody></table>
  <p class="sa-note">Joints: ${Math.round(rate * 100)}% of profit (price − cost). Cookies: ${Math.round(rate * 100)}% of the owner's ${Math.round(ownerShare * 100)}% cookie share. Credit sales count once paid; wholesale and rewards earn nothing.</p>`;
}

let commissionData = null;
let commissionPromise = null;

function loadCommissionData(force = false) {
  if (commissionPromise && !force) return commissionPromise;
  commissionPromise = Promise.all([
    getJson('staff_commission_summary?select=*').catch(() => []),
    getJson('staff_settlements?select=amount_ugx,paid_at,note&order=paid_at.desc&limit=50').catch(() => []),
    getJson('joint_costs?select=category_id,cost_ugx').catch(() => []),
    getJson('cookie_costs?select=category_id,wholesale_ugx').catch(() => []),
  ]).then(([summary, payouts, jointCosts, cookieCosts]) => {
    commissionData = { summary: summary?.[0] || null, payouts, jointCosts, cookieCosts };
    paintStaffAnalytics();
    return commissionData;
  });
  return commissionPromise;
}

function commissionSection() {
  if (!commissionData) return '<p class="sa-empty">Loading commission…</p>';
  const r = commissionData.summary;
  if (!r) return '<p class="sa-empty">No commission rate set yet.</p>';
  const rate = Number(r.rate || 0);
  const row = (label, e, p, j, c) =>
    `<tr><th scope="row">${label}</th><td>${fmtUGX(e)}</td><td>${fmtUGX(p)}</td><td>${fmtUGX(j)}</td><td>${fmtUGX(c)}</td></tr>`;
  const payouts = commissionData.payouts || [];
  return `
    <div class="sa-hero">
      <div><div class="sa-hero__val">${fmtUGX(r.balance)}</div><div class="sa-hero__lbl">Balance owed to you</div></div>
      ${Number(r.pending_credit) > 0 ? `<div class="sa-hero__side">+ ${fmtUGX(r.pending_credit)}<span>pending on unpaid credit</span></div>` : ''}
    </div>
    <table class="commission-table sa-commission">
      <thead><tr><th></th><th>Earned</th><th>Paid</th><th>Joints</th><th>Cookies</th></tr></thead>
      <tbody>
        ${row('This week', r.earned_week, r.paid_week, r.joint_earned_week, r.cookie_earned_week)}
        ${row('This month', r.earned_month, r.paid_month, r.joint_earned_month, r.cookie_earned_month)}
        ${row('All time', r.earned_all, r.paid_all, r.joint_earned_all, r.cookie_earned_all)}
      </tbody>
    </table>
    ${Number(r.pending_credit) > 0 ? `<p class="sa-note">Pending credit: joints ${fmtUGX(r.joint_pending_credit)} · cookies ${fmtUGX(r.cookie_pending_credit)}</p>` : ''}
    <div class="section-title">Payout history</div>
    ${
      payouts.length
        ? `<ul class="sa-payouts">${payouts
            .map(
              (p) => `<li><span>${new Date(p.paid_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: KAMPALA })}${p.note ? ` · ${escapeHtml(p.note)}` : ''}</span><b>${fmtUGX(p.amount_ugx)}</b></li>`,
            )
            .join('')}</ul>`
        : '<p class="sa-empty">No payouts yet.</p>'
    }
    <div class="section-title">Commission per item</div>
    ${rateTable(rate, commissionData.jointCosts, commissionData.cookieCosts, COOKIE_OWNER_SHARE)}`;
}

function salesSection() {
  const sales = mySales();
  const now = Date.now();
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now - i * 86400000);
    days.push({ key: kampalaDayKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: KAMPALA }), value: 0, units: 0 });
  }
  const dayIdx = new Map(days.map((d, i) => [d.key, i]));
  const weeks = [];
  for (let i = 7; i >= 0; i -= 1) weeks.push({ label: i === 0 ? 'This wk' : `${i}w ago`, value: 0 });
  const products = new Map();
  const flavors = new Map();
  let total = 0;
  let units = 0;
  let weekCount = 0;
  for (const s of sales) {
    const t = new Date(s.created_at).getTime();
    total += Number(s.total_ugx) || 0;
    const u = unitsOfSale(s);
    units += u.joints + u.cookies;
    const di = dayIdx.get(kampalaDayKey(s.created_at));
    if (di != null) {
      days[di].value += 1;
      days[di].units += u.joints + u.cookies;
    }
    const w = Math.floor((now - t) / (7 * 86400000));
    if (w >= 0 && w < 8) weeks[7 - w].value += 1;
    if (w === 0) weekCount += 1;
    for (const it of Array.isArray(s.items) ? s.items : []) {
      const name = it?.product_name || it?.product_id || 'Item';
      products.set(name, (products.get(name) || 0) + (Number(it?.quantity) || 1));
      for (const [k, v] of Object.entries(it?.breakdown || {})) flavors.set(k, (flavors.get(k) || 0) + (Number(v) || 0));
    }
  }
  const dels = myDeliveries();
  const delFees = dels.reduce((sum, d) => sum + (Number(d.fee_ugx) || 0), 0);
  const topProducts = [...products.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
  const topFlavors = [...flavors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, value]) => {
      const c = CAT_MAP[k];
      return { label: c ? `${c.name}${c.sub ? ` ${c.sub}` : ''}` : k, value, color: c?.color };
    });
  return `
    <div class="section-title">My sales</div>
    <div class="sa-stats">
      ${stat('Sales', sales.length, `${weekCount} this week`)}
      ${stat('Units sold', units)}
      ${stat('Average order', sales.length ? fmtCompact(Math.round(total / sales.length)) : '—')}
      ${stat('Deliveries', dels.length, dels.length ? `${fmtCompact(delFees)} fees` : '')}
    </div>
    <div class="analytics-block sa-chart"><div class="sa-chart__title">Sales per day · last 7 days</div>${barChart(days)}</div>
    <div class="analytics-block sa-chart"><div class="sa-chart__title">Sales per week · last 8 weeks</div>${barChart(weeks)}</div>
    <div class="section-title">Top products</div>
    ${hbars(topProducts)}
    <div class="section-title">Top flavors</div>
    ${hbars(topFlavors)}`;
}

export function paintStaffAnalytics() {
  const el = document.getElementById('staffAnalytics');
  if (!el) return;
  el.innerHTML = `<div class="section-title">My commission</div>${commissionSection()}${salesSection()}`;
}

export function renderStaffAnalytics() {
  paintStaffAnalytics();
  void loadCommissionData();
}

export function refreshStaffAnalytics() {
  void loadCommissionData(true);
}

export function renderStaffDeliveries() {
  const el = document.getElementById('staffDeliveryList');
  if (!el) return;
  const rows = myDeliveries()
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!rows.length) {
    el.innerHTML = '<div class="receipt-empty">No deliveries yet</div>';
    return;
  }
  const saleIds = new Set(mySales().map((s) => s.id));
  el.innerHTML = `<ul class="sa-deliveries">${rows
    .map((d) => {
      const when = new Date(d.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: KAMPALA });
      const who = d.client_name || 'No client';
      const where = d.dest_label || 'Drop-off';
      const sale = d.sale_id ? (saleIds.has(d.sale_id) ? `Sale #${String(d.sale_id).slice(0, 6)}` : 'Linked sale') : 'No sale';
      return `<li class="sa-delivery"><div class="sa-delivery__top"><span class="sa-delivery__who">${escapeHtml(who)}</span><b>${fmtUGX(d.fee_ugx)}</b></div><div class="sa-delivery__meta">${escapeHtml(when)} · ${escapeHtml(where)}</div><div class="sa-delivery__sale">${escapeHtml(sale)}</div></li>`;
    })
    .join('')}</ul>`;
}
