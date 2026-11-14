import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { clients, loadClients } from '../data/entities';
import { loadStoreAccounts, storeAccounts } from '../data/store-accounts';
import { clientPeople, suggestClients, type ClientSuggestion } from '../domain/client-suggest';
import { Field } from './Field';

export function ClientSuggest({
  value,
  onChange,
  testId = 'cart-client',
}: {
  value: string;
  onChange: (next: { name: string; id: string; phone?: string }) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadClients().catch(() => {});
    void loadStoreAccounts().catch(() => {});
  }, []);

  const people = useMemo(
    () => clientPeople(clients.value, storeAccounts.value),
    [clients.value, storeAccounts.value],
  );
  const suggestions = useMemo(() => suggestClients(value, people), [value, people]);
  const shown = open && suggestions.length > 0;

  useEffect(() => {
    setActive(0);
  }, [value]);

  useEffect(() => {
    if (!shown) return undefined;
    const onDoc = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [shown]);

  function pick(row: ClientSuggestion) {
    onChange({ name: row.name, id: row.id, phone: row.phone });
    setOpen(false);
  }

  function onKey(event: KeyboardEvent) {
    if (!shown) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      const row = suggestions[active];
      if (row) {
        event.preventDefault();
        pick(row);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div class="v-suggest" ref={box}>
      <Field
        label="Client"
        data-testid={testId}
        value={value}
        placeholder="Name"
        autocomplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKey}
        onInput={(e) => {
          onChange({ name: (e.target as HTMLInputElement).value, id: '' });
          setOpen(true);
        }}
      />
      {shown ? (
        <ul class="v-suggest__list" role="listbox" data-testid="client-suggest">
          {suggestions.map((row, i) => (
            <li key={row.key}>
              <button
                type="button"
                class={`v-suggest__opt${i === active ? ' is-active' : ''}`}
                role="option"
                aria-selected={i === active ? 'true' : 'false'}
                data-testid={`client-suggest-${row.key}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(row);
                }}
              >
                <span class="v-suggest__name">{row.name}</span>
                {row.phone ? <span class="v-suggest__meta">{row.phone}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
