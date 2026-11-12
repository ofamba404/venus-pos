import { useEffect, useMemo, useState } from 'preact/hooks';
import { sbFetch } from '../../data/api';
import { patchDelivery, postDelivery } from '../../data/writes/deliveries';
import {
  fitDeliveryFeeModel,
  modelConfidence,
  predictSafeBodaFee,
  predictSafeBodaFeeRange,
} from '../../domain/delivery-fee';
import { setCheckoutDraft } from '../../data/checkout-draft';
import { Money } from '../../ui/Money';
import { Field } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { showToast } from '../../ui/ToastHost';

type DeliveryRow = {
  id: string;
  client_name?: string;
  fee_ugx?: number;
  distance_km?: number;
  duration_min?: number;
  created_at?: string;
  location_lat?: number;
  location_lng?: number;
};

export function DeliveryPage() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [km, setKm] = useState('4');
  const [edit, setEdit] = useState<DeliveryRow | null>(null);
  const [fee, setFee] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await sbFetch('deliveries?select=*&order=created_at.desc&limit=100');
        if (!res.ok) throw new Error(`deliveries ${res.status}`);
        setRows((await res.json()) as DeliveryRow[]);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not load deliveries');
      }
    })();
  }, []);

  const model = useMemo(() => fitDeliveryFeeModel(rows), [rows]);
  const confidence = modelConfidence(model);
  const kmNum = Number(km);
  const point =
    Number.isFinite(kmNum) && kmNum >= 0 ? predictSafeBodaFee(kmNum, model) : null;
  const range =
    Number.isFinite(kmNum) && kmNum >= 0 ? predictSafeBodaFeeRange(kmNum, model) : null;

  async function logPreset() {
    const res = await postDelivery({
      client_name: 'SafeBoda test',
      distance_km: Number.isFinite(kmNum) ? kmNum : null,
      fee_ugx: point ?? 0,
      fee_was_edited: false,
    });
    if (!res.ok) {
      showToast('Could not log quote');
      return;
    }
    showToast('Quote logged');
  }

  async function saveTrip() {
    if (!edit) return;
    const res = await patchDelivery(edit.id, { fee_ugx: Math.round(Number(fee) || 0) });
    if (!res.ok) {
      showToast('Could not save trip');
      return;
    }
    setRows((list) =>
      list.map((row) => (row.id === edit.id ? { ...row, fee_ugx: Math.round(Number(fee) || 0) } : row)),
    );
    setEdit(null);
    showToast('Trip saved');
  }

  function applyToCheckout() {
    if (point === undefined || point === null) {
      showToast('Need more logged quotes to predict');
      return;
    }
    setCheckoutDraft({
      feeValue: String(point),
      distanceKm: kmNum,
      predictedFee: point,
      feeManuallyEdited: false,
      destText: `${kmNum.toFixed(1)} km quote lab`,
    });
    showToast(`Fee ${point.toLocaleString('en-UG')} UGX ready for checkout`);
  }

  return (
    <section>
      <h1 class="page-title">Delivery</h1>

      <div class="v-order-card" style={{ display: 'grid', gap: 12 }}>
        <div class="v-list-row__title">Quote lab</div>
        <div class="v-muted">
          {model
            ? `${confidence.label} · R² ${Math.round((model.r2 || 0) * 100)}% · ${rows.length} trips`
            : 'Log SafeBoda quotes to unlock estimates'}
        </div>
        {model ? (
          <span class="v-bars__track" aria-hidden="true">
            <span style={{ width: `${Math.max(4, Math.round((model.r2 || 0) * 100))}%` }} />
          </span>
        ) : null}
        <Field
          label="Distance (km)"
          inputMode="decimal"
          value={km}
          onInput={(e) => setKm((e.target as HTMLInputElement).value)}
        />
        <div class="v-stat-grid">
          <div class="v-stat">
            <div class="v-stat__label">Estimate</div>
            <div class="v-stat__value">{point !== undefined && point !== null ? <Money value={point} /> : '—'}</div>
          </div>
          <div class="v-stat">
            <div class="v-stat__label">Range</div>
            <div class="v-stat__value" style={{ font: 'var(--t-title-sm)' }}>
              {range ? (
                <>
                  <Money value={range.feeMinUgx} />–<Money value={range.feeMaxUgx} />
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
        <Button variant="secondary" data-testid="quote-log" onClick={() => void logPreset()}>
          Log preset
        </Button>
        <Button variant="secondary" onClick={applyToCheckout}>
          Use estimate on next sale
        </Button>
      </div>

      <div class="v-section-label">Trips</div>
      {rows.map((r) => {
        const maxFee = Math.max(1, ...rows.map((row) => Number(row.fee_ugx) || 0));
        return (
        <button
          type="button"
          class="v-list-row"
          key={r.id}
          data-testid={`trip-${r.id}`}
          onClick={() => {
            setEdit(r);
            setFee(String(r.fee_ugx ?? ''));
          }}
        >
          <div class="v-list-row__main">
            <div class="v-list-row__title">{r.client_name || 'Trip'}</div>
            <div class="v-list-row__meta">
              {r.distance_km !== undefined && r.distance_km !== null ? `${Number(r.distance_km).toFixed(1)} km · ` : ''}
              {r.created_at
                ? new Date(r.created_at).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </div>
            <span class="v-bars__track" aria-hidden="true">
              <span style={{ width: `${((Number(r.fee_ugx) || 0) / maxFee) * 100}%` }} />
            </span>
          </div>
          <Money value={Number(r.fee_ugx) || 0} />
        </button>
        );
      })}
      {!rows.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No trips yet</p>
        </div>
      ) : null}
      <Sheet open={Boolean(edit)} title="Edit trip" onClose={() => setEdit(null)} dismissible={false}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div class="v-list-row__title">{edit?.client_name || 'Trip'}</div>
          <Field
            label="Fee (UGX)"
            inputMode="numeric"
            data-testid="trip-fee"
            value={fee}
            onInput={(e) => setFee((e.target as HTMLInputElement).value)}
          />
          <Button data-testid="trip-save" onClick={() => void saveTrip()}>
            Save trip
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
