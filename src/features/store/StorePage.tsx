import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_CLOSE,
  DEFAULT_OPEN,
  isBusyActive,
  isWithinOpenHours,
  toHHmm,
  type FulfillmentStatus,
} from '../../domain/hours';
import { sbFetch } from '../../data/api';
import { Field } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

export function StorePage() {
  const [status, setStatus] = useState<FulfillmentStatus>({
    openTime: DEFAULT_OPEN,
    closeTime: DEFAULT_CLOSE,
  });
  const [busy, setBusy] = useState(false);

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
  }, []);

  async function saveHours() {
    setBusy(true);
    try {
      const res = await sbFetch('store_fulfillment?id=eq.1', {
        method: 'PATCH',
        body: JSON.stringify({
          open_time: status.openTime,
          close_time: status.closeTime,
          suggest_start: status.suggestStart,
          suggest_end: status.suggestEnd,
        }),
      });
      if (!res.ok) throw new Error(`Could not save hours (${res.status})`);
      showToast('Hours saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save hours');
    } finally {
      setBusy(false);
    }
  }

  const openNow = isWithinOpenHours(new Date(), status);
  const busyNow = isBusyActive(status);

  return (
    <section>
      <h1 class="page-title">Store</h1>
      <div class="v-order-card" style={{ display: 'grid', gap: 12 }}>
        <div class="v-muted">
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
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="secondary" onClick={() => (location.href = '/')}>
          Open legacy admin
        </Button>
      </div>
    </section>
  );
}
