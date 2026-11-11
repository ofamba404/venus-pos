import { useEffect, useState } from 'preact/hooks';
import { sbFetch } from '../../data/api';
import { Money } from '../../ui/Money';
import { showToast } from '../../ui/ToastHost';

type DeliveryRow = {
  id: string;
  client_name?: string;
  fee_ugx?: number;
  distance_km?: number;
  created_at?: string;
};

export function DeliveryPage() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await sbFetch('deliveries?select=*&order=created_at.desc&limit=50');
        if (!res.ok) throw new Error(`deliveries ${res.status}`);
        setRows((await res.json()) as DeliveryRow[]);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not load deliveries');
      }
    })();
  }, []);

  return (
    <section>
      <h1 class="page-title">Delivery</h1>
      {rows.map((r) => (
        <div class="v-list-row" key={r.id}>
          <div style={{ flex: 1 }}>
            <div class="v-list-row__title">{r.client_name || 'Trip'}</div>
            <div class="v-list-row__meta">
              {r.distance_km != null ? `${Number(r.distance_km).toFixed(1)} km · ` : ''}
              {r.created_at
                ? new Date(r.created_at).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </div>
          </div>
          <Money value={Number(r.fee_ugx) || 0} />
        </div>
      ))}
      {!rows.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No trips yet</p>
        </div>
      ) : null}
    </section>
  );
}
