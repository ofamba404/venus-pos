import { useEffect, useState } from 'preact/hooks';
import { clients, loadClients, loadSales, sales } from '../../data/entities';
import { getClientOutstandingCredit, sumCreditOwed } from '../../domain/credit';
import { Money } from '../../ui/Money';
import { showToast } from '../../ui/ToastHost';

export function ClientsPage() {
  const [q, setQ] = useState('');

  useEffect(() => {
    void Promise.all([loadClients(), loadSales()]).catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load clients'),
    );
  }, []);

  const list = clients.value
    .filter((c) => String(c.name || '').toLowerCase().includes(q.toLowerCase()))
    .slice(0, 100);

  return (
    <section>
      <h1 class="page-title">Clients</h1>
      <input
        class="v-field__input"
        placeholder="Search"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        style={{ width: '100%', marginBottom: 12 }}
      />
      {list.map((c) => {
        const owed = sumCreditOwed(getClientOutstandingCredit(sales.value, c.id));
        return (
          <div class="v-list-row" key={c.id}>
            <div style={{ flex: 1 }}>
              <div class="v-list-row__title">{c.name}</div>
              <div class="v-list-row__meta">{c.phone || c.id.slice(0, 8)}</div>
            </div>
            {owed > 0 ? (
              <span style={{ color: 'var(--danger)' }}>
                <Money value={owed} />
              </span>
            ) : (
              <span style={{ color: 'var(--fg-3)', font: 'var(--t-meta)' }}>Clear</span>
            )}
          </div>
        );
      })}
    </section>
  );
}
