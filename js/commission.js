/**
 * Commission card (home page).
 *   pos_staff — "My commission": earned / paid / balance for week, month, all time,
 *               with a joints-vs-cookies earned breakdown (credit counts once paid).
 *   pos_admin — per-staff summary + "Record payout" (writes staff_settlements).
 * Data: views staff_commission_summary (RLS-scoped) and rpc pos_staff_directory.
 */
import { sbFetch } from './api.js';
import { getPageHref } from './config.js';
import { escapeHtml, fmtUGX, showToast } from './utils.js';

let loading = null;

async function getJson(path, options) {
  const res = await sbFetch(path, options);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json().catch(() => []);
}

function statRow(label, earned, paid) {
  return `<tr><th scope="row">${label}</th><td>${fmtUGX(earned)}</td><td>${fmtUGX(paid)}</td></tr>`;
}

/** Staff home: minimal — balance owed, details live on the staff Analytics page. */
function staffMiniCard(row) {
  return `
    <div class="commission-mini">
      <div class="commission-mini__lbl">Commission owed</div>
      <div class="commission-mini__row">
        <div class="commission-mini__val">${fmtUGX(row.balance)}</div>
        <a class="commission-mini__link" href="${getPageHref('analytics')}" data-spa-page="analytics">See details ›</a>
      </div>
    </div>`;
}

function splitRow(label, joints, cookies) {
  return `<tr><th scope="row">${label}</th><td>${fmtUGX(joints || 0)}</td><td>${fmtUGX(cookies || 0)}</td></tr>`;
}

function staffBlock(row, name, isAdmin) {
  const rate = Math.round(Number(row.rate || 0) * 100);
  return `
    <div class="commission-staff" data-staff-id="${escapeHtml(row.staff_id)}">
      <div class="commission-head">
        <div>
          <div class="commission-name">${escapeHtml(name)}</div>
          <div class="commission-sub">${rate}% of joint profit · ${rate}% of your cookie share · ${Number(row.joint_units_all || 0)} joints · ${Number(row.cookie_units_all || 0)} cookies</div>
        </div>
        <div class="commission-balance">
          <div class="commission-balance__val">${fmtUGX(row.balance)}</div>
          <div class="commission-balance__lbl">balance owed</div>
        </div>
      </div>
      <table class="commission-table">
        <thead><tr><th></th><th scope="col">Earned</th><th scope="col">Paid</th></tr></thead>
        <tbody>
          ${statRow('This week', row.earned_week, row.paid_week)}
          ${statRow('This month', row.earned_month, row.paid_month)}
          ${statRow('All time', row.earned_all, row.paid_all)}
        </tbody>
      </table>
      <table class="commission-table commission-split">
        <thead><tr><th></th><th scope="col">Joints</th><th scope="col">Cookies</th></tr></thead>
        <tbody>
          ${splitRow('This week', row.joint_earned_week, row.cookie_earned_week)}
          ${splitRow('This month', row.joint_earned_month, row.cookie_earned_month)}
          ${splitRow('All time', row.joint_earned_all, row.cookie_earned_all)}
        </tbody>
      </table>
      ${Number(row.pending_credit) > 0 ? `<p class="commission-note">+ ${fmtUGX(row.pending_credit)} pending on unpaid credit sales</p>` : ''}
      ${isAdmin ? `<button type="button" class="commission-pay" data-record-payout="${escapeHtml(row.staff_id)}" data-staff-name="${escapeHtml(name)}" data-balance="${Number(row.balance || 0)}">Record payout</button>` : ''}
    </div>`;
}

async function recordPayout(staffId, name, balance) {
  const raw = window.prompt(`Payout amount (UGX) to ${name}`, balance > 0 ? String(balance) : '');
  if (raw == null) return;
  const amount = Math.round(Number(String(raw).replace(/[^0-9]/g, '')));
  if (!amount || amount <= 0) {
    showToast('Enter an amount above 0', true);
    return;
  }
  const note = window.prompt('Note (optional)', '') || null;
  try {
    await getJson('staff_settlements', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ staff_id: staffId, amount_ugx: amount, note }),
    });
    showToast(`Recorded ${fmtUGX(amount)} paid to ${name}`);
    await renderCommissionCard({ force: true });
  } catch (e) {
    console.error('record payout failed', e);
    showToast('Could not record payout', true);
  }
}

export async function renderCommissionCard({ force = false } = {}) {
  const el = document.getElementById('commissionCard');
  if (!el) return;
  const auth = window.VenusPosAuth;
  const isAdmin = auth?.isAdmin?.() === true;
  const isStaff = auth?.isStaffOnly?.() === true;
  if (!isAdmin && !isStaff) {
    el.hidden = true;
    return;
  }
  if (loading && !force) return loading;

  loading = (async () => {
    try {
      let rows = await getJson('staff_commission_summary?select=*');
      if (isAdmin) {
        // Hide test/hidden staff from the owner's summary (flag lives in staff_commission_rates.is_hidden).
        const flags = await getJson('staff_commission_rates?select=user_id,is_hidden').catch(() => []);
        const hidden = new Set((flags || []).filter((f) => f.is_hidden).map((f) => f.user_id));
        rows = rows.filter((r) => !hidden.has(r.staff_id));
      }
      let names = {};
      if (isAdmin) {
        const dir = await getJson('rpc/pos_staff_directory', { method: 'POST', body: '{}' }).catch(() => []);
        names = Object.fromEntries((dir || []).map((d) => [d.user_id, (d.email || '').split('@')[0]]));
      }
      if (!rows.length) {
        el.hidden = !isStaff;
        el.innerHTML = isStaff ? '<h2 class="commission-title">My commission</h2><p class="commission-note">No commission rate set yet.</p>' : '';
        return;
      }
      el.hidden = false;
      if (isStaff) {
        el.innerHTML = staffMiniCard(rows[0]);
        return;
      }
      el.innerHTML = `
        <h2 class="commission-title">${isAdmin ? 'Staff commission' : 'My commission'}</h2>
        ${rows.map((r) => staffBlock(r, isAdmin ? names[r.staff_id] || 'Staff' : 'You', isAdmin)).join('')}`;
    } catch (e) {
      // Migrations not applied yet, or offline — keep the home page clean.
      console.warn('commission card unavailable', e?.message || e);
      el.hidden = true;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function wireCommissionCard() {
  const el = document.getElementById('commissionCard');
  if (!el || el.dataset.wired) return;
  el.dataset.wired = '1';
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-record-payout]');
    if (!btn) return;
    void recordPayout(btn.dataset.recordPayout, btn.dataset.staffName || 'staff', Number(btn.dataset.balance) || 0);
  });
}
