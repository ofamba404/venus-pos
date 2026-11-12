import { useEffect, useState } from 'preact/hooks';
import { clients, loadClients, loadSales, sales, type SaleRow } from '../../data/entities';
import { saleItems, saveSaleEdit, voidSaleRecord } from '../../data/sale-edit';
import { postClient } from '../../data/writes/clients';
import { localPhoneDigits } from '../../domain/phone';
import { FlavorSwatches } from '../../ui/FlavorSwatches';
import { productImageSrc } from '../../domain/product-art';
import { groupSalesByDay, partitionThisWeek } from '../../domain/history-groups';
import { Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { HistoryEditSheet } from './HistoryEditSheet';

type Filter = 'all' | 'week' | 'credit';

export function HistoryPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof saleItems>>([]);
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCredit, setEditCredit] = useState(false);
  const [editCleared, setEditCleared] = useState(false);

  useEffect(() => {
    void Promise.all([loadSales(), loadClients()]).catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load history'),
    );
  }, []);

  const base =
    filter === 'credit'
      ? sales.value.filter((s) => s.is_credit && !s.credit_cleared)
      : filter === 'week'
        ? partitionThisWeek(sales.value).thisWeek.flatMap((g) => g.sales)
        : sales.value;

  const groups = groupSalesByDay(base);
  const open = sales.value.find((row) => row.id === openId) || null;

  function closeAll() {
    setOpenId(null);
    setEditing(false);
    setVoiding(false);
    setDraft([]);
  }

  async function saveEdit() {
    if (!open || busy) return;
    setBusy(true);
    try {
      const typed = editName.trim();
      const match = clients.value.find((c) => String(c.name || '').trim().toLowerCase() === typed.toLowerCase());
      let clientId = typed ? match?.id || open.client_id || null : null;
      if (typed && !match) {
        const created = await postClient(typed);
        if (created.ok) {
          const rows = (await created.json().catch(() => [])) as Array<{ id?: string }>;
          clientId = rows[0]?.id || clientId;
          await loadClients().catch(() => {});
        }
      }
      await saveSaleEdit(open, {
        items: draft,
        clientId,
        isCredit: editCredit,
        creditCleared: editCleared,
      });
      showToast('Order updated');
      closeAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save order');
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!open || busy) return;
    setBusy(true);
    try {
      await voidSaleRecord(open);
      showToast('Order voided');
      closeAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not void order');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1 class="page-title">History</h1>
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'week', label: 'This week' },
            { id: 'credit', label: 'Credit' },
          ]}
        />
      </div>
      {!groups.length ? (
        <div class="v-empty">
          <p class="v-empty__title">No sales yet</p>
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.key} data-testid="history-day">
          <div class="v-section-label">
            {g.dateObj.toLocaleDateString('en-GB', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
            })}{' '}
            · {g.count} · <Money value={g.total} />
          </div>
          {g.sales.map((s) => {
            const full = (sales.value.find((row) => row.id === s.id) || s) as SaleRow;
            const credit = Boolean(full.is_credit && !full.credit_cleared);
            const delivery = Boolean(full.delivery_enabled);
            const person = clients.value.find((c) => c.id === full.client_id)?.name;
            const items = saleItems(full);
            const first = items[0];
            return (
              <button
                type="button"
                class="v-list-row"
                key={s.id}
                data-testid={`history-sale-${s.id}`}
                onClick={() => {
                  setOpenId(String(s.id || ''));
                  setEditing(false);
                  setVoiding(false);
                }}
              >
                {first?.product_id && productImageSrc(String(first.product_id), first.breakdown as Record<string, unknown>) ? (
                  <img
                    class="v-thumb"
                    src={productImageSrc(String(first.product_id), first.breakdown as Record<string, unknown>)}
                    alt=""
                  />
                ) : null}
                <div class="v-list-row__main">
                  <div class="v-list-row__title">
                    {person || (full.store_order_id ? 'Store customer' : 'Counter')}
                  </div>
                  <div class="v-list-row__meta">
                    {items.slice(0, 3).map((item, index) => (
                      <div key={`${item.product_id}-${index}`}>
                        <div>{item.product_name || 'Item'}</div>
                        <FlavorSwatches
                          breakdown={item.breakdown as Record<string, unknown>}
                          productId={String(item.product_id || '')}
                        />
                      </div>
                    ))}
                    <span>
                      {new Date(s.created_at || '').toLocaleString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {delivery ? ' · Delivery' : ''}
                    </span>
                  </div>
                </div>
                <Tag tone={credit ? 'credit' : 'paid'}>{credit ? 'Credit' : 'Paid'}</Tag>
                <Money className="v-money--amber" value={Number(s.total_ugx) || 0} />
              </button>
            );
          })}
        </div>
      ))}

      <Sheet
        open={Boolean(open) && !editing && !voiding}
        title="Sale"
        onClose={closeAll}
      >
        {open ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div class="v-list-row__title">
              <Money value={Number(open.total_ugx) || 0} />
            </div>
            {saleItems(open).map((item, index) => (
              <div class="v-list-row__meta" key={`${item.product_id}-${index}`}>
                {item.product_name || 'Item'} · {item.detail || ''}
              </div>
            ))}
            {String(open.client_phone || '') ? (
              <Button
                size="md"
                variant="secondary"
                data-testid="history-copy-phone"
                onClick={() => {
                  const digits = localPhoneDigits(String(open.client_phone || ''));
                  void navigator.clipboard?.writeText(digits).then(
                    () => showToast('Phone copied'),
                    () => showToast(digits),
                  );
                }}
              >
                Copy phone
              </Button>
            ) : null}
            {String(open.location_label || '') ? (
              <Button
                size="md"
                variant="secondary"
                data-testid="history-copy-location"
                onClick={() => {
                  const text = String(open.location_label || '');
                  void navigator.clipboard?.writeText(text).then(
                    () => showToast('Location copied'),
                    () => showToast(text),
                  );
                }}
              >
                Copy location
              </Button>
            ) : null}
            <Button
              data-testid="sale-edit"
              onClick={() => {
                setDraft(saleItems(open));
                const person = clients.value.find((c) => c.id === open.client_id)?.name || '';
                setEditName(person);
                setEditCredit(Boolean(open.is_credit));
                setEditCleared(Boolean(open.credit_cleared));
                setEditing(true);
              }}
            >
              Edit sale
            </Button>
            <Button variant="danger" data-testid="sale-void" onClick={() => setVoiding(true)}>
              Void sale
            </Button>
          </div>
        ) : null}
      </Sheet>

      <HistoryEditSheet
        open={editing}
        busy={busy}
        draft={draft}
        name={editName}
        credit={editCredit}
        cleared={editCleared}
        onClose={() => setEditing(false)}
        onName={setEditName}
        onCredit={(next) => {
          setEditCredit(next);
          if (!next) setEditCleared(false);
        }}
        onCleared={setEditCleared}
        onDraft={setDraft}
        onSave={() => void saveEdit()}
      />

      {voiding && open ? (
        <div class="v-sheet-scrim" style={{ zIndex: 40 }}>
          <div
            role="alertdialog"
            aria-label="Void sale"
            class="v-sheet"
            style={{ zIndex: 41 }}
          >
            <div class="v-sheet__body">
              <p>Void this sale? Stock is returned and the sale is deleted.</p>
              <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
                <Button variant="danger" data-testid="void-confirm" disabled={busy} onClick={() => void confirmVoid()}>
                  Void sale
                </Button>
                <Button variant="secondary" data-testid="void-keep" onClick={() => setVoiding(false)}>
                  Keep sale
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
