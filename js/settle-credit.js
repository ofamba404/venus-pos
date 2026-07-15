import { sbFetch } from './api.js';
import { dataStore } from './store/index.js';
import {
  allocatePaymentFifo,
  creditBalance,
  getClientOutstandingCredit,
  getOutstandingCredit,
  sumCreditOwed,
} from './credit.js';
import { clients, salesCache } from './state.js';
import { closeModal, openModal } from './animations.js';
import { escapeHtml, fmtUGX, showToast } from './utils.js';

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'other', label: 'Other' },
];

let settleResolve = null;
let settleContext = null;

function parseAmount(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  return Math.round(Number(digits));
}

function closeSettleModal(result = null) {
  const overlay = document.getElementById('settleOverlay');
  if (overlay) closeModal(overlay);
  if (settleResolve) {
    settleResolve(result);
    settleResolve = null;
  }
  settleContext = null;
}

function renderSettleForm() {
  const body = document.getElementById('settleModalBody');
  if (!body || !settleContext) return;

  const { name, owed, orderCount, defaultAmount } = settleContext;
  const ordersLabel =
    orderCount === 1 ? '1 open order' : `${orderCount} open orders`;

  body.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="settleModalTitle">Record payment</div>
      <button class="modal-close" id="settleClose" type="button" aria-label="Close">✕</button>
    </div>
    <div class="settle-sub">
      <div class="settle-client">${escapeHtml(name)}</div>
      <div class="settle-owed">${fmtUGX(owed)} owed · ${ordersLabel}</div>
    </div>
    <label class="settle-label" for="settleAmount">Amount (UGX)</label>
    <div class="settle-amount-row">
      <input type="text" inputmode="numeric" pattern="[0-9]*" id="settleAmount" class="qty-input settle-amount" value="${defaultAmount}" autocomplete="off" />
      <button type="button" class="settle-full-btn" id="settleFullBtn">Full</button>
    </div>
    <div class="settle-label">Method</div>
    <div class="settle-methods" role="radiogroup" aria-label="Payment method">
      ${METHODS.map(
        (m, i) => `
        <label class="settle-method">
          <input type="radio" name="settleMethod" value="${m.id}" ${i === 0 ? 'checked' : ''} />
          <span>${m.label}</span>
        </label>`,
      ).join('')}
    </div>
    <label class="settle-label" for="settleNote">Note <span class="settle-optional">optional</span></label>
    <input type="text" id="settleNote" class="client-input settle-note" placeholder="e.g. paid at shop" autocomplete="off" maxlength="120" />
    <p class="settle-hint">Payments apply to oldest open orders first.</p>
    <div class="modal-btns">
      <button class="modal-btn cancel" id="settleCancel" type="button">Cancel</button>
      <button class="modal-btn confirm" id="settleConfirm" type="button">Record payment</button>
    </div>`;

  document.getElementById('settleClose')?.addEventListener('click', () => closeSettleModal(null));
  document.getElementById('settleCancel')?.addEventListener('click', () => closeSettleModal(null));
  document.getElementById('settleFullBtn')?.addEventListener('click', () => {
    const input = document.getElementById('settleAmount');
    if (input) input.value = String(owed);
    input?.focus();
  });
  document.getElementById('settleConfirm')?.addEventListener('click', () => {
    const amount = parseAmount(document.getElementById('settleAmount')?.value);
    const method =
      document.querySelector('input[name="settleMethod"]:checked')?.value || 'cash';
    const note = document.getElementById('settleNote')?.value?.trim() || '';
    if (amount <= 0) {
      showToast('Enter a payment amount', true);
      return;
    }
    if (amount > owed) {
      showToast(`Max is ${fmtUGX(owed)}`, true);
      return;
    }
    closeSettleModal({ amount, method, note });
  });

  const amountInput = document.getElementById('settleAmount');
  amountInput?.focus();
  amountInput?.select();
  amountInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('settleConfirm')?.click();
  });
}

/**
 * Prompt for payment details. Resolves null if cancelled.
 * @param {{ name: string, owed: number, orderCount: number, defaultAmount?: number }} opts
 */
export function promptSettlePayment(opts) {
  const overlay = document.getElementById('settleOverlay');
  if (!overlay) return Promise.resolve(null);

  settleContext = {
    name: opts.name || 'Client',
    owed: opts.owed,
    orderCount: opts.orderCount || 1,
    defaultAmount: opts.defaultAmount ?? opts.owed,
  };
  renderSettleForm();
  openModal(overlay);
  return new Promise((resolve) => {
    settleResolve = resolve;
  });
}

export function wireSettleOverlay() {
  const overlay = document.getElementById('settleOverlay');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettleModal(null);
  });
}

function applyLocalSaleUpdates(allocations, clearedAt) {
  for (const { sale, newPaid, clears } of allocations) {
    const local = salesCache.find((s) => s.id === sale.id);
    if (!local) continue;
    local.amount_paid_ugx = newPaid;
    if (clears) {
      local.credit_cleared = true;
      local.cleared_at = clearedAt;
    }
  }
}

/**
 * Record a payment against open credit sales (FIFO within the given set).
 * Writes credit_payments audit rows and updates sales.amount_paid_ugx / credit_cleared.
 */
export async function recordCreditPayment({ openSales, amount, method, note, clientId }) {
  const allocations = allocatePaymentFifo(openSales, amount);
  if (allocations.length === 0) throw new Error('Nothing to apply');

  const clearedAt = new Date().toISOString();
  const paymentRows = allocations.map(({ sale, applyUgx }) => ({
    sale_id: sale.id,
    client_id: clientId || sale.client_id || null,
    amount_ugx: applyUgx,
    method: method || 'cash',
    note: note || null,
  }));

  const payRes = await sbFetch('credit_payments', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(paymentRows),
  });
  if (!payRes.ok) {
    const detail = await payRes.text().catch(() => '');
    throw new Error(`Payment insert failed (${payRes.status})${detail ? `: ${detail}` : ''}`);
  }

  for (const { sale, newPaid, clears } of allocations) {
    const patch = {
      amount_paid_ugx: newPaid,
      ...(clears
        ? { credit_cleared: true, cleared_at: clearedAt }
        : { credit_cleared: false, cleared_at: null }),
    };
    const res = await sbFetch(`sales?id=eq.${sale.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Sale update failed (${res.status})`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Sale update blocked — no rows updated');
    }
  }

  applyLocalSaleUpdates(allocations, clearedAt);
  await dataStore.invalidate('sales');

  const applied = allocations.reduce((sum, a) => sum + a.applyUgx, 0);
  const clearedCount = allocations.filter((a) => a.clears).length;
  return { applied, clearedCount, allocations };
}

export async function settleSaleCredit(saleId) {
  const sale = salesCache.find((s) => s.id === saleId);
  if (!sale || creditBalance(sale) <= 0) return false;

  const client = sale.client_id ? clients.find((c) => c.id === sale.client_id) : null;
  const owed = creditBalance(sale);
  const details = await promptSettlePayment({
    name: client?.name || 'Unknown client',
    owed,
    orderCount: 1,
    defaultAmount: owed,
  });
  if (!details) return false;

  try {
    const result = await recordCreditPayment({
      openSales: [sale],
      amount: details.amount,
      method: details.method,
      note: details.note,
      clientId: sale.client_id || null,
    });
    const msg =
      result.clearedCount > 0
        ? `Paid ${fmtUGX(result.applied)} — order settled`
        : `Paid ${fmtUGX(result.applied)} toward order`;
    showToast(msg);
    return true;
  } catch (e) {
    console.error('settle sale credit failed', e);
    showToast('Could not record payment', true);
    return false;
  }
}

export async function settleClientCredit(clientId) {
  const open = getClientOutstandingCredit(salesCache, clientId);
  if (open.length === 0) return false;

  const client = clients.find((c) => c.id === clientId);
  const owed = sumCreditOwed(open);
  const details = await promptSettlePayment({
    name: client?.name || 'Client',
    owed,
    orderCount: open.length,
    defaultAmount: owed,
  });
  if (!details) return false;

  try {
    const result = await recordCreditPayment({
      openSales: open,
      amount: details.amount,
      method: details.method,
      note: details.note,
      clientId,
    });
    const left = sumCreditOwed(getClientOutstandingCredit(salesCache, clientId));
    const msg =
      left > 0
        ? `Paid ${fmtUGX(result.applied)} — ${fmtUGX(left)} still owed`
        : `Paid ${fmtUGX(result.applied)} — all settled`;
    showToast(msg);
    return true;
  } catch (e) {
    console.error('settle client credit failed', e);
    showToast('Could not record payment', true);
    return false;
  }
}

/** Remaining AR for a client (from salesCache). */
export function clientArSummary(clientId) {
  const open = getClientOutstandingCredit(salesCache, clientId);
  if (!open.length) return null;
  return { count: open.length, totalUgx: sumCreditOwed(open) };
}

export { getOutstandingCredit, sumCreditOwed };
