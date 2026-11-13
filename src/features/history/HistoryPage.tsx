import { useEffect, useState } from 'preact/hooks';
import { clients, loadClients, loadSales, sales, type SaleRow } from '../../data/entities';
import { saleItems, saveSaleEdit, voidSaleRecord } from '../../data/sale-edit';
import { postClient } from '../../data/writes/clients';
import { EmptyState } from '../../ui/EmptyState';
import { HistoryRow } from '../../ui/HistoryRow';
import { productImageSrc } from '../../domain/product-art';
import {
  dayLabel,
  defaultOpenDay,
  groupDaysByWeek,
  groupSalesByDay,
  mondayOfWeek,
  partitionThisWeek,
  salesCount,
  type DayGroup,
  type WeekGroup,
} from '../../domain/history-groups';
import { Collapse } from '../../ui/Collapse';
import { IconChevronRight } from '../../ui/icons';
import { Money } from '../../ui/Money';
import { Tag } from '../../ui/Tag';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { creditBalance } from '../../domain/credit';
import { DeliveryCopyRow } from '../../ui/DeliveryCopyRow';
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
  // Day and week headings the user opened or closed, over the defaults.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
  // This week's days are listed (newest first, only the first one open). Older days fold into one heading per week.
  const sections = (() => {
    if (filter === 'credit') return { recent: groups, weeks: [] as WeekGroup[] };
    const monday = mondayOfWeek(new Date());
    return {
      recent: groups.filter((g) => g.dateObj >= monday),
      weeks: groupDaysByWeek(groups.filter((g) => g.dateObj < monday)),
    };
  })();
  const startOpen = filter === 'credit' ? null : defaultOpenDay(groups);
  function isOpenKey(key: string, fallback: boolean) {
    return key in expanded ? Boolean(expanded[key]) : fallback;
  }
  function toggleKey(key: string, fallback: boolean) {
    setExpanded((prev) => ({ ...prev, [key]: !isOpenKey(key, fallback) }));
  }

  function renderDay(g: DayGroup) {
    // Credit view is a short list of what is owed, so its days start open.
    const isOpen = isOpenKey(`d:${g.key}`, startOpen === null || g.key === startOpen);
    const owed = g.sales.reduce((sum, s) => {
      const row = (sales.value.find((r) => r.id === s.id) || s) as SaleRow;
      return sum + (row.is_credit && !row.credit_cleared ? creditBalance(row) : 0);
    }, 0);
    return (
      <div key={g.key} class="history-day" data-testid="history-day">
        <button
          type="button"
          class="history-head"
          aria-expanded={isOpen}
          data-testid={`history-day-toggle-${g.key}`}
          onClick={() => toggleKey(`d:${g.key}`, startOpen === null || g.key === startOpen)}
        >
          <span class="history-head__name">{dayLabel(g.dateObj)}</span>
          <span class="history-head__sum" data-testid="history-day-sum">
            {salesCount(g.count)}
            {' · '}
            <Money value={g.total} />
            {owed > 0 ? <span class="history-head__owed"> · owed <Money value={owed} /></span> : null}
          </span>
          <span class={`history-head__chev${isOpen ? ' is-open' : ''}`} aria-hidden="true">
            <IconChevronRight size={18} />
          </span>
        </button>
        <Collapse open={isOpen}>{g.sales.map(renderSale)}</Collapse>
      </div>
    );
  }

  function renderSale(s: (typeof groups)[number]['sales'][number]) {
    const full = (sales.value.find((row) => row.id === s.id) || s) as SaleRow;
    const credit = Boolean(full.is_credit && !full.credit_cleared);
    const delivery = Boolean(full.delivery_enabled);
    const person = clients.value.find((c) => c.id === full.client_id)?.name;
    const items = saleItems(full);
    const first = items[0];
    return (
      <HistoryRow
        key={s.id}
        testId={`history-sale-${s.id}`}
        name={person || (full.store_order_id ? 'Store client' : 'Counter')}
        when={`${new Date(s.created_at || '').toLocaleString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })}${delivery ? ' · Delivery' : ''}`}
        image={
          first?.product_id
            ? productImageSrc(String(first.product_id), first.breakdown as Record<string, unknown>)
            : ''
        }
        lines={items.slice(0, 2).map((item) => ({
          name: String(item.product_name || 'Item'),
          productId: String(item.product_id || ''),
          breakdown: item.breakdown as Record<string, unknown>,
        }))}
        tags={<Tag tone={credit ? 'credit' : 'paid'}>{credit ? 'Credit' : 'Paid'}</Tag>}
        amount={
          credit ? (
            <span class="history-owed" data-testid={`history-owed-${s.id}`}>
              <span class="history-owed__label">owes</span>
              <Money className="v-money--total" value={creditBalance(full)} />
            </span>
          ) : (
            <Money className="v-money--total" value={Number(s.total_ugx) || 0} />
          )
        }
        onOpen={() => {
          setOpenId(String(s.id || ''));
          setEditing(false);
          setVoiding(false);
        }}
      />
    );
  }
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
        <EmptyState title="No sales yet" body="Completed sales land here." />
      ) : null}
      {sections.recent.map(renderDay)}
      {sections.weeks.map((w) => {
        const isOpen = isOpenKey(`w:${w.key}`, false);
        return (
          <div key={w.key} class="history-week" data-testid="history-week">
            <button
              type="button"
              class="history-head history-head--week"
              aria-expanded={isOpen}
              data-testid={`history-week-toggle-${w.key}`}
              onClick={() => toggleKey(`w:${w.key}`, false)}
            >
              <span class="history-head__name">
                Week of {w.monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
              <span class="history-head__sum">
                {salesCount(w.count)} · <Money value={w.total} />
              </span>
              <span class={`history-head__chev${isOpen ? ' is-open' : ''}`} aria-hidden="true">
                <IconChevronRight size={18} />
              </span>
            </button>
            <Collapse open={isOpen}>{w.days.map(renderDay)}</Collapse>
          </div>
        );
      })}

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
            <DeliveryCopyRow
              delivery={open.delivery_enabled === true || Boolean(String(open.location_label || ''))}
              name={clients.value.find((c) => c.id === open.client_id)?.name || ''}
              phone={String(open.client_phone || '')}
              place={String(open.location_label || '')}
              lat={open.location_lat as number | null | undefined}
              lng={open.location_lng as number | null | undefined}
              collect={creditBalance(open)}
              idPrefix="history-copy-"
            />
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
