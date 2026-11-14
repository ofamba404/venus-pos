import { useEffect, useMemo, useState } from 'preact/hooks';
import { isAdmin } from '../../data/auth';
import { CopyButton } from '../../ui/CopyButton';
import { clients, loadClients, loadSales, sales } from '../../data/entities';
import { loadStoreAccounts, storeAccounts } from '../../data/store-accounts';
import {
  getClientOutstandingCredit,
  creditBalance,
  sumCreditOwed,
} from '../../domain/credit';
import {
  filterCounts,
  filterPeople,
  mergePeople,
  personMeta,
  type Person,
  type PersonFilter,
} from '../../domain/people';
import { deleteClient, patchClient, postClient } from '../../data/writes/clients';
import { settleCredit } from '../../data/credit-settle';
import { deleteStoreAccount, patchStoreAccount, storeAuth } from '../../data/writes/store';
import { Money } from '../../ui/Money';
import { Sheet } from '../../ui/Sheet';
import { Field } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { PersonRow } from '../../ui/PersonRow';
import { clientNamesText } from '../../domain/parity';

/** First letter of a name. A phone-number name has no letter, so it gets a hash mark. */
function avatarInitial(name: string | null | undefined): string {
  const c = String(name || '').trim().charAt(0).toUpperCase();
  if (!c) return '?';
  return /[0-9+]/.test(c) ? '#' : c;
}

const FILTERS: Array<{ id: PersonFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'walkin', label: 'Walk-in' },
  { id: 'storefront', label: 'Storefront' },
  { id: 'owes', label: 'Owes' },
];

const PAGE = 60;

export function ClientsPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<PersonFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editName, setEditName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<'client' | 'account' | null>(null);

  const [searchFocused, setSearchFocused] = useState(false);
  const admin = isAdmin();

  useEffect(() => {
    void Promise.allSettled([loadClients(), loadSales(), loadStoreAccounts()]).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      if (failed && failed.status === 'rejected') {
        const e = failed.reason;
        showToast(e instanceof Error ? e.message : 'Could not load clients');
      }
    });
  }, []);

  // Read signals during render so the list updates when any of the three finishes loading.
  const clientRows = clients.value;
  const saleRows = sales.value;
  const accountRows = storeAccounts.value;
  const searching = searchFocused || q.trim().length > 0;

  const people = useMemo(() => {
    const owedByClient = new Map<string, number>();
    for (const sale of saleRows) {
      const left = creditBalance(sale);
      if (left > 0 && sale.client_id) owedByClient.set(sale.client_id, (owedByClient.get(sale.client_id) || 0) + left);
    }
    const lastOrderByClient = new Map<string, string>();
    for (const sale of saleRows) {
      if (!sale.client_id || !sale.created_at) continue;
      const prev = lastOrderByClient.get(sale.client_id);
      if (!prev || new Date(sale.created_at).getTime() > new Date(prev).getTime()) {
        lastOrderByClient.set(sale.client_id, sale.created_at);
      }
    }
    const merged = mergePeople(clientRows, accountRows, { owedByClient, lastOrderByClient });
    return merged.sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
  }, [clientRows, accountRows, saleRows]);

  const counts = filterCounts(people);
  const list = filterPeople(people, filter, q);
  const visible = list.slice(0, shown);
  const open = openKey ? people.find((p) => p.key === openKey) || null : null;

  const openSales = open?.client ? getClientOutstandingCredit(saleRows, open.client.id) : [];
  const owed = sumCreditOwed(openSales);

  function openPerson(person: Person) {
    setOpenKey(person.key);
    setEditName(person.client?.name || '');
    setAccountName(String(person.account?.pos_display_name || ''));
    setAmount(person.owed > 0 ? String(person.owed) : '');
    setNote('');
    setResetCode('');
    setConfirmDelete(null);
  }

  function closeSheet() {
    setOpenKey(null);
    setConfirmDelete(null);
    setResetCode('');
  }

  async function settle() {
    const clientId = open?.client?.id;
    if (!clientId || owed <= 0) return;
    const pay = Math.min(owed, Math.max(0, Math.round(Number(amount) || 0)));
    if (pay <= 0) {
      showToast('Enter an amount');
      return;
    }
    setBusy(true);
    try {
      const result = await settleCredit({ openSales, clientId, amount: pay, note });
      if (!result.ok) throw new Error(result.error);
      showToast(`Settled ${pay.toLocaleString('en-UG')} UGX`);
      setAmount('');
      setNote('');
      closeSheet();
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
    const res = await postClient(name);
    if (!res.ok) {
      showToast('Could not add client');
      return;
    }
    setNewName('');
    showToast('Client added');
    await loadClients({ force: true }).catch(() => {});
  }

  async function renameClient() {
    if (!open?.client) return;
    const res = await patchClient(open.client.id, { name: editName.trim() });
    if (!res.ok) {
      showToast('Could not rename client');
      return;
    }
    showToast('Client renamed');
    await loadClients({ force: true }).catch(() => {});
  }

  async function removeClient() {
    if (!open?.client) return;
    const res = await deleteClient(open.client.id);
    if (!res.ok) {
      showToast('Could not delete client');
      return;
    }
    showToast('Client deleted');
    closeSheet();
    await loadClients({ force: true }).catch(() => {});
  }

  async function patchAccount(body: Record<string, unknown>, toast: string) {
    if (!open?.account) return;
    const res = await patchStoreAccount(open.account.id, body);
    if (!res.ok) {
      showToast('Could not update user');
      return;
    }
    showToast(toast);
    await loadStoreAccounts().catch(() => {});
  }

  async function issueReset() {
    if (!open?.account) return;
    const result = await storeAuth('admin_issue_reset_code', { user_id: open.account.id });
    if (!result.ok || !result.data.code) {
      showToast(result.data.error || 'Could not create reset code');
      return;
    }
    setResetCode(result.data.code);
    showToast('Reset code ready');
  }

  async function removeAccount() {
    if (!open?.account) return;
    const res = await deleteStoreAccount(open.account.id);
    if (!res.ok) {
      showToast('Could not delete user');
      return;
    }
    showToast('User deleted');
    closeSheet();
    await loadStoreAccounts().catch(() => {});
  }

  return (
    <section>
      <h1 class="page-title">Clients</h1>
      <div class={`clients-search${searching ? ' is-searching' : ''}`} data-testid="clients-search-wrap">
      <input
        class="v-field__input"
        placeholder="Search name or phone"
        aria-label="Search clients"
        data-testid="client-search"
        value={q}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setShown(PAGE);
        }}
      />
      </div>
      {!searching ? (
      <>
      <div class="v-add-row">
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
      <div class="v-filter-row" role="tablist" aria-label="Filter people" data-testid="client-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            class={`v-filter ${filter === f.id ? 'is-on' : ''}`}
            data-testid={`client-filter-${f.id}`}
            onClick={() => {
              setFilter(f.id);
              setShown(PAGE);
            }}
          >
            {f.label}
            <span class="v-filter__count">{counts[f.id]}</span>
          </button>
        ))}
      </div>
      <div class="v-toolbar">
        <Button
          size="md"
          variant="secondary"
          data-testid="copy-client-names"
          onClick={() => {
            const text = clientNamesText(clientRows.map((c) => c.name));
            void navigator.clipboard?.writeText(text);
            showToast(text ? 'Names copied' : 'No clients');
          }}
        >
          Copy names
        </Button>
        <span class="v-muted" data-testid="client-count">
          {list.length} {list.length === 1 ? 'person' : 'people'}
        </span>
      </div>
      </>
      ) : null}

      <div data-testid="client-list">
        {visible.map((person) => (
          <PersonRow
            key={person.key}
            testId={`person-${person.client?.id || person.account?.id}`}
            name={person.name}
            initial={avatarInitial(person.name)}
            meta={personMeta(person)}
            tags={
              person.account ? (
                <span class="v-tag v-tag--bronze-soft" data-testid="storefront-tag">
                  Storefront
                </span>
              ) : null
            }
            status={
              person.owed > 0 ? (
                <span class="v-owed" data-testid="owed-tag">
                  <Money value={person.owed} />
                </span>
              ) : person.client ? (
                <span class="v-tag">Clear</span>
              ) : null
            }
            onOpen={() => openPerson(person)}
          />
        ))}
        {!visible.length ? <p class="v-muted">Nobody matches. Try another filter or search.</p> : null}
        {list.length > visible.length ? (
          <Button
            size="md"
            variant="secondary"
            data-testid="client-show-more"
            onClick={() => setShown((n) => n + PAGE)}
          >
            Show {Math.min(PAGE, list.length - visible.length)} more
          </Button>
        ) : null}
      </div>

      <Sheet open={Boolean(open)} title={open?.name || 'Client'} onClose={closeSheet}>
        {open ? (
          <div class="person-sheet" data-testid="person-sheet" data-kind={open.client && open.account ? 'both' : open.client ? 'client' : 'account'}>
            <div class="person-sheet__tags">
              {open.client ? <span class="v-tag">POS client</span> : null}
              {open.account ? <span class="v-tag v-tag--bronze-soft">Storefront</span> : null}
              {open.account ? (
                <span class={open.account.verified ? 'v-tag v-tag--paid' : 'v-tag'}>
                  {open.account.verified ? 'Verified' : 'Not verified'}
                </span>
              ) : null}
              {open.phone ? <span class="v-muted">{open.phone}</span> : null}
            </div>

            {open.client ? (
              <section class="person-sheet__section" data-testid="section-client">
                <h3 class="v-section-label">Client</h3>
                {owed > 0 ? (
                  <p class="person-sheet__owes">
                    Owes <Money className="v-money--total" value={owed} />
                  </p>
                ) : (
                  <p class="v-muted" data-testid="settle-clear">Nothing owed.</p>
                )}
                {admin && owed > 0 ? (
                  <>
                    <Field
                      label="Amount (UGX)"
                      inputMode="numeric"
                      data-testid="settle-amount"
                      value={amount}
                      onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
                    />
                    <Field
                      label="Note"
                      value={note}
                      placeholder="Optional"
                      onInput={(e) => setNote((e.target as HTMLInputElement).value)}
                    />
                    <Button
                      size="lg"
                      data-testid="settle-confirm"
                      disabled={busy || owed <= 0}
                      onClick={() => void settle()}
                    >
                      {busy ? 'Saving…' : 'Record payment'}
                    </Button>
                  </>
                ) : null}
                <Field
                  label="Name"
                  data-testid="client-edit-name"
                  value={editName}
                  onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
                />
                <Button size="md" variant="secondary" data-testid="client-rename" onClick={() => void renameClient()}>
                  Save name
                </Button>
                {admin ? (
                  confirmDelete === 'client' ? (
                    <div class="person-sheet__confirm" role="alert">
                      <span>Delete {open.client.name || 'this client'}? Their past sales are kept.</span>
                      <div class="person-sheet__confirm-row">
                        <Button size="md" variant="ghost" data-testid="client-delete-cancel" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </Button>
                        <Button size="md" variant="danger" data-testid="client-delete-confirm" onClick={() => void removeClient()}>
                          Yes, delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" class="v-link-danger" data-testid="client-delete" onClick={() => setConfirmDelete('client')}>
                      Delete client
                    </button>
                  )
                ) : null}
              </section>
            ) : null}

            {open.account ? (
              <section class="person-sheet__section" data-testid="section-account">
                <h3 class="v-section-label">Storefront account</h3>
                <Field
                  label="Display name"
                  data-testid="store-user-name"
                  value={accountName}
                  onInput={(e) => setAccountName((e.target as HTMLInputElement).value)}
                />
                <div class="v-chip-row person-sheet__actions">
                  <Button
                    size="md"
                    data-testid="store-user-save"
                    onClick={() => void patchAccount({ pos_display_name: accountName }, 'Name saved')}
                  >
                    Save name
                  </Button>
                  {admin && !open.account.verified ? (
                    <Button
                      size="md"
                      variant="secondary"
                      data-testid="store-user-verify"
                      onClick={() => void patchAccount({ verified: true }, 'User verified')}
                    >
                      Verify
                    </Button>
                  ) : null}
                  <Button size="md" variant="secondary" data-testid="store-user-reset" onClick={() => void issueReset()}>
                    Reset code
                  </Button>
                </div>
                {resetCode ? (
                  <div class="v-reset-code" data-testid="store-reset-code">
                    <strong class="v-reset-code__value">{resetCode}</strong>
                    <CopyButton
                      kind="text"
                      label="Copy"
                      doneLabel="Copied"
                      ariaLabel="Copy reset code"
                      compact
                      testId="copy-reset-code"
                      value={() => resetCode}
                    />
                  </div>
                ) : null}
                {admin ? (
                  confirmDelete === 'account' ? (
                    <div class="person-sheet__confirm" role="alert">
                      <span>Delete this storefront account? They will need to sign up again.</span>
                      <div class="person-sheet__confirm-row">
                        <Button size="md" variant="ghost" data-testid="store-user-delete-cancel" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </Button>
                        <Button size="md" variant="danger" data-testid="store-user-delete-confirm" onClick={() => void removeAccount()}>
                          Yes, delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" class="v-link-danger" data-testid="store-user-delete" onClick={() => setConfirmDelete('account')}>
                      Delete account
                    </button>
                  )
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
