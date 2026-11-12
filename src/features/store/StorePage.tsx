import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_CLOSE,
  DEFAULT_OPEN,
  busyUntilFromNow,
  isBusyActive,
  isWithinOpenHours,
  toHHmm,
  type FulfillmentStatus,
} from '../../domain/hours';
import { sbFetch } from '../../data/api';
import { deleteStoreAccount, patchFulfillment, patchStoreAccount } from '../../data/writes/store';
import { Field } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

type StoreUser = {
  id: string;
  phone?: string;
  pos_display_name?: string | null;
  verified?: boolean;
};

export function StorePage() {
  const [status, setStatus] = useState<FulfillmentStatus>({
    openTime: DEFAULT_OPEN,
    closeTime: DEFAULT_CLOSE,
  });
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<StoreUser[]>([]);
  const [userName, setUserName] = useState('');

  async function loadUsers() {
    const res = await sbFetch('store_accounts?select=*&limit=20');
    if (!res.ok) return;
    const rows = (await res.json()) as StoreUser[];
    setUsers(rows);
    const target = rows.find((row) => !row.verified) || rows[0];
    if (target && !userName) setUserName(String(target.pos_display_name || ''));
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await sbFetch('store_fulfillment?select=*&limit=1');
        if (!res.ok) return;
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        const row = rows[0];
        if (!row) return;
        setStatus({
          openTime: toHHmm(row.open_time) || DEFAULT_OPEN,
          closeTime: toHHmm(row.close_time) || DEFAULT_CLOSE,
          suggestStart: toHHmm(row.suggest_start),
          suggestEnd: toHHmm(row.suggest_end),
          busyUntil: row.busy_until ? String(row.busy_until) : null,
          busyFor: (row.busy_for as FulfillmentStatus['busyFor']) || 'both',
        });
      } catch {
        /* offline / missing table */
      }
    })();
    void loadUsers().catch(() => {});
  }, []);

  async function saveHours() {
    setBusy(true);
    try {
      const res = await patchFulfillment({
        open_time: status.openTime,
        close_time: status.closeTime,
        suggest_start: status.suggestStart,
        suggest_end: status.suggestEnd,
      });
      if (!res.ok) throw new Error(`Could not save hours (${res.status})`);
      showToast('Hours saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save hours');
    } finally {
      setBusy(false);
    }
  }

  async function setBusyMinutes(minutes: number | null) {
    setBusy(true);
    try {
      const until = minutes == null ? null : busyUntilFromNow(minutes);
      const res = await patchFulfillment({
        busy_until: until,
        busy_for: minutes == null ? null : 'both',
      });
      if (!res.ok) throw new Error(`Could not update busy (${res.status})`);
      setStatus((current) => ({
        ...current,
        busyUntil: until,
        busyFor: minutes == null ? undefined : 'both',
      }));
      showToast(minutes == null ? 'Busy cleared' : `Busy for ${minutes} min`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update busy');
    } finally {
      setBusy(false);
    }
  }

  function targetUser() {
    return users.find((row) => !row.verified) || users[0] || null;
  }

  async function patchUser(body: Record<string, unknown>, toast: string) {
    const user = targetUser();
    if (!user) {
      showToast('No store user');
      return;
    }
    const res = await patchStoreAccount(user.id, body);
    if (!res.ok) {
      showToast('Could not update user');
      return;
    }
    showToast(toast);
    await loadUsers().catch(() => {});
  }

  async function deleteUser() {
    const user = targetUser();
    if (!user) return;
    const res = await deleteStoreAccount(user.id);
    if (!res.ok) {
      showToast('Could not delete user');
      return;
    }
    showToast('User deleted');
    await loadUsers().catch(() => {});
  }

  const openNow = isWithinOpenHours(new Date(), status);
  const busyNow = isBusyActive(status);

  return (
    <section>
      <h1 class="page-title">Store</h1>
      <div class="v-order-card" style={{ display: 'grid', gap: 12 }}>
        <div class="v-muted" data-testid="store-status">
          Status: {busyNow ? 'Busy' : openNow ? 'Open' : 'Closed'} · defaults {DEFAULT_OPEN}–
          {DEFAULT_CLOSE}
        </div>
        <Field
          label="Open"
          value={status.openTime || ''}
          onInput={(e) =>
            setStatus((s) => ({ ...s, openTime: (e.target as HTMLInputElement).value }))
          }
        />
        <Field
          label="Close"
          value={status.closeTime || ''}
          onInput={(e) =>
            setStatus((s) => ({ ...s, closeTime: (e.target as HTMLInputElement).value }))
          }
        />
        <Field
          label="Suggest start"
          value={status.suggestStart || ''}
          onInput={(e) =>
            setStatus((s) => ({ ...s, suggestStart: (e.target as HTMLInputElement).value }))
          }
        />
        <Field
          label="Suggest end"
          value={status.suggestEnd || ''}
          onInput={(e) =>
            setStatus((s) => ({ ...s, suggestEnd: (e.target as HTMLInputElement).value }))
          }
        />
        <Button size="lg" disabled={busy} onClick={() => void saveHours()}>
          {busy ? 'Saving…' : 'Save hours'}
        </Button>
        <div class="v-chip-row">
          <Button size="md" data-testid="busy-30" disabled={busy} onClick={() => void setBusyMinutes(30)}>
            Busy 30 min
          </Button>
          <Button
            size="md"
            variant="secondary"
            data-testid="busy-clear"
            disabled={busy}
            onClick={() => void setBusyMinutes(null)}
          >
            Clear busy
          </Button>
        </div>
      </div>
      <div class="v-section-label">Storefront users</div>
      <div class="v-order-card" style={{ display: 'grid', gap: 12 }}>
        <Field
          label="POS name"
          data-testid="store-user-name"
          value={userName}
          onInput={(e) => setUserName((e.target as HTMLInputElement).value)}
        />
        <div class="v-chip-row">
          <Button size="md" data-testid="store-user-save" onClick={() => void patchUser({ pos_display_name: userName }, 'Name saved')}>
            Save name
          </Button>
          <Button size="md" variant="secondary" data-testid="store-user-verify" onClick={() => void patchUser({ verified: true }, 'User verified')}>
            Verify
          </Button>
          <Button size="md" variant="danger" data-testid="store-user-delete" onClick={() => void deleteUser()}>
            Delete
          </Button>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="secondary" onClick={() => (location.href = '/')}>
          Open legacy admin
        </Button>
      </div>
    </section>
  );
}
