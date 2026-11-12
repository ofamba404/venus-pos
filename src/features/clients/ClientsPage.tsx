import { useEffect, useState } from 'preact/hooks';
import { clients, loadClients, loadSales, sales, type SaleRow } from '../../data/entities';
import {
  allocatePaymentFifo,
  getClientOutstandingCredit,
  sumCreditOwed,
} from '../../domain/credit';
import { sbFetch } from '../../data/api';
import { Money } from '../../ui/Money';
import { Sheet } from '../../ui/Sheet';
import { Field } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { showToast } from '../../ui/ToastHost';

export function ClientsPage() {
  const [q, setQ] = useState('');
  const [settleId, setSettleId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'mobile_money'>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    void Promise.all([loadClients(), loadSales()]).catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load clients'),
    );
  }, []);

  const list = clients.value
    .filter((c) => String(c.name || '').toLowerCase().includes(q.toLowerCase()))
    .slice(0, 100);

  const settleClient = settleId ? clients.value.find((c) => c.id === settleId) : null;
  const openSales = settleId ? getClientOutstandingCredit(sales.value, settleId) : [];
  const owed = sumCreditOwed(openSales);

  async function settle() {
    if (!settleId || owed <= 0) return;
    const pay = Math.min(owed, Math.max(0, Math.round(Number(amount) || 0)));
    if (pay <= 0) {
      showToast('Enter an amount');
      return;
    }
    setBusy(true);
    try {
      const allocations = allocatePaymentFifo(openSales, pay);
      for (const row of allocations) {
        const sale = row.sale as SaleRow;
        if (!sale.id) continue;
        const res = await sbFetch(`sales?id=eq.${encodeURIComponent(sale.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            amount_paid_ugx: row.newPaid,
            credit_cleared: row.clears,
            ...(row.clears ? { cleared_at: new Date().toISOString() } : {}),
          }),
        });
        if (!res.ok) throw new Error(`Could not update sale (${res.status})`);
      }
      await sbFetch('credit_payments', {
        method: 'POST',
        body: JSON.stringify({
          client_id: settleId,
          amount_ugx: pay,
          method,
          note: note.trim() || null,
        }),
      }).catch(() => {});
      showToast(`Settled ${pay.toLocaleString('en-UG')} UGX`);
      setSettleId(null);
      setAmount('');
      setNote('');
      await loadSales({ force: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Settle failed');
    } finally {
      setBusy(false);
    }
  }

  async function addClient() {
    const name = newName.trim();
    if (!name) return;
    const res = await sbFetch('clients', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      showToast('Could not add client');
      return;
    }
    setNewName('');
    showToast('Client added');
    await loadClients().catch(() => {});
  }

  async function renameClient() {
    if (!editId) return;
    const res = await sbFetch(`clients?id=eq.${encodeURIComponent(editId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (!res.ok) {
      showToast('Could not rename client');
      return;
    }
    setEditId(null);
    showToast('Client renamed');
    await loadClients().catch(() => {});
  }

  async function deleteClient() {
    if (!editId) return;
    const res = await sbFetch(`clients?id=eq.${encodeURIComponent(editId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      showToast('Could not delete client');
      return;
    }
    setEditId(null);
    showToast('Client deleted');
    await loadClients().catch(() => {});
  }

  return (
    <section>
      <h1 class="page-title">Clients</h1>
      <div class="v-chip-row" style={{ marginBottom: 12 }}>
        <Field
          label="New client"
          data-testid="client-add-name"
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
        />
        <Button size="md" data-testid="client-add" onClick={() => void addClient()}>
          Add
        </Button>
      </div>
      <input
        class="v-field__input"
        placeholder="Search"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        style={{ marginBottom: 12 }}
      />
      {list.map((c) => {
        const clientOwed = sumCreditOwed(getClientOutstandingCredit(sales.value, c.id));
        return (
          <button
            type="button"
            class="v-list-row"
            key={c.id}
            onClick={() => {
              if (clientOwed > 0) {
                setSettleId(c.id);
                setAmount(String(clientOwed));
                return;
              }
              setEditId(c.id);
              setEditName(c.name || '');
            }}
          >
            <div class="v-list-row__main">
              <div class="v-list-row__title">{c.name}</div>
              <div class="v-list-row__meta">{c.phone || c.id.slice(0, 8)}</div>
            </div>
            {clientOwed > 0 ? (
              <span style={{ color: 'var(--danger)', lineHeight: 1 }}>
                <Money value={clientOwed} />
              </span>
            ) : (
              <span class="v-muted">Clear</span>
            )}
          </button>
        );
      })}

      <Sheet
        open={Boolean(settleId)}
        title={settleClient?.name || 'Settle credit'}
        onClose={() => setSettleId(null)}
        footer={
          <Button
            size="xl"
            data-testid="settle-confirm"
            disabled={busy || owed <= 0}
            onClick={() => void settle()}
          >
            {busy ? 'Saving…' : 'Record payment'}
          </Button>
        }
      >
        <p class="v-muted" style={{ marginTop: 0 }}>
          Owes <Money value={owed} />
        </p>
        <Field
          label="Amount (UGX)"
          inputMode="numeric"
          data-testid="settle-amount"
          value={amount}
          onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
        />
        <div style={{ height: 12 }} />
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { id: 'cash', label: 'Cash' },
            { id: 'mobile_money', label: 'Mobile money' },
          ]}
        />
        <div style={{ height: 12 }} />
        <Field
          label="Note"
          value={note}
          placeholder="Optional"
          onInput={(e) => setNote((e.target as HTMLInputElement).value)}
        />
      </Sheet>
      <Sheet
        open={Boolean(editId)}
        title="Client"
        onClose={() => setEditId(null)}
        footer={
          <Button size="xl" data-testid="client-rename" onClick={() => void renameClient()}>
            Save name
          </Button>
        }
      >
        <Field
          label="Name"
          data-testid="client-edit-name"
          value={editName}
          onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
        />
        <div style={{ height: 12 }} />
        <Button size="md" variant="danger" data-testid="client-delete" onClick={() => void deleteClient()}>
          Delete
        </Button>
      </Sheet>
    </section>
  );
}
