import { useEffect, useState } from 'preact/hooks';
import { loadSales, sales, type SaleRow } from '../../data/entities';
import { bumpFirstLine, saleItems, saveSaleItems, voidSaleRecord } from '../../data/sale-edit';
import { groupSalesByDay, partitionThisWeek } from '../../domain/history-groups';
import { Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';

type Filter = 'all' | 'week' | 'credit';

export function HistoryPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof saleItems>>([]);
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSales().catch((e) =>
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
      await saveSaleItems(open, draft);
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
                <div class="v-list-row__main">
                  <div class="v-list-row__title">
                    {new Date(s.created_at || '').toLocaleString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <div class="v-list-row__meta">
                    {full.store_order_id ? 'Store order' : delivery ? 'Delivery' : 'Counter'}
                  </div>
                </div>
                <Tag tone={credit ? 'credit' : 'paid'}>{credit ? 'Credit' : 'Paid'}</Tag>
                <Money value={Number(s.total_ugx) || 0} />
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
            <Button
              data-testid="sale-edit"
              onClick={() => {
                setDraft(saleItems(open));
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

      <Sheet open={editing} title="Edit sale" onClose={() => setEditing(false)} dismissible={false}>
        <div style={{ display: 'grid', gap: 12 }}>
          {draft.map((item, index) => (
            <div key={`${item.product_id}-${index}`}>
              <div class="v-list-row__title">{item.product_name || 'Item'}</div>
              <div class="v-list-row__meta">{item.detail}</div>
              <div class="v-list-row__meta">
                <Money value={Number(item.line_total) || 0} />
              </div>
            </div>
          ))}
          <Button data-testid="sale-edit-inc" variant="secondary" onClick={() => setDraft(bumpFirstLine(draft))}>
            Add 1
          </Button>
          <Button data-testid="sale-edit-save" disabled={busy} onClick={() => void saveEdit()}>
            Save sale
          </Button>
        </div>
      </Sheet>

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
