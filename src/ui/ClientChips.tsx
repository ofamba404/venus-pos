import { useState } from 'preact/hooks';
import { clients, loadClients, sales } from '../data/entities';
import { loadStoreAccounts, storeAccounts } from '../data/store-accounts';
import { postClient } from '../data/writes/clients';
import { openDebtForClientName } from '../domain/credit';
import { clientOwesLabel } from '../domain/parity';
import {
  chipClients,
  clientPeople,
  exactClientMatch,
  highlightMatches,
  type ClientSuggestion,
} from '../domain/client-suggest';
import { showToast } from './ToastHost';
import { Field } from './Field';

export type ClientPick = { name: string; id: string; phone?: string };

type Props = {
  value: string;
  onChange: (next: ClientPick) => void;
};

/** Name field plus predictive chips (no dropdown). Add client when the typed name is new. */
export function ClientChips({ value, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const people = clientPeople(clients.value, storeAccounts.value);
  const chips = chipClients(value, people);
  const exact = exactClientMatch(value, people);
  const showAdd = Boolean(value.trim()) && !exact;

  function pick(row: ClientSuggestion) {
    onChange({ name: row.name, id: row.id, phone: row.phone || undefined });
  }

  async function addClient() {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await postClient(name);
      if (!res.ok) throw new Error('Could not add client');
      const rows = (await res.json()) as Array<{ id?: string; name?: string }>;
      const row = Array.isArray(rows) ? rows[0] : (rows as { id?: string; name?: string } | undefined);
      const id = String(row?.id || '');
      if (id) clients.value = [...clients.value, { id, name }];
      onChange({ name, id });
      void loadClients({ force: true }).catch(() => {});
      void loadStoreAccounts().catch(() => {});
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not add client');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="v-client-chips" data-testid="client-chips">
      <Field
        label="Client"
        data-testid="cart-client"
        value={value}
        placeholder="Name"
        autoComplete="off"
        onInput={(e) => {
          const name = (e.target as HTMLInputElement).value;
          onChange({ name, id: exactClientMatch(name, people)?.client?.id || '' });
        }}
      />
      <div class="v-chip-row">
        {showAdd ? (
          <button
            type="button"
            class="v-tag v-tag--add"
            data-testid="add-client"
            disabled={busy}
            onClick={() => void addClient()}
          >
            Add client
          </button>
        ) : null}
        {chips.map((row) => {
          const owes = clientOwesLabel(openDebtForClientName(row.name, clients.value, sales.value));
          const active = value.trim().toLowerCase() === row.name.trim().toLowerCase();
          return (
            <button
              key={row.key}
              type="button"
              class={active ? 'v-tag is-active' : 'v-tag'}
              data-testid={`client-chip-${row.key}`}
              onClick={() => pick(row)}
            >
              <span class="v-tag__name">
                {highlightMatches(row.name, value).map((part, i) =>
                  part.hit ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>,
                )}
              </span>
              {owes ? ` · ${owes}` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
