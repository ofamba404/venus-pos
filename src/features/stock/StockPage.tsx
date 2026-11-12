import { useEffect, useState } from 'preact/hooks';
import { CATEGORIES } from '../../domain/catalog';
import { stockLevel } from '../../domain/stock-state';
import { stockGlance } from '../../domain/parity';
import {
  adjustInventory,
  ensureInventory,
  inventory,
  inventoryReady,
  setInventoryCount,
} from '../../data/entities';
import { FlavorDot } from '../../ui/FlavorDot';
import { Tag } from '../../ui/Tag';
import { Sheet } from '../../ui/Sheet';
import { Field } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { showToast } from '../../ui/ToastHost';
import { haptic } from '../../platform/haptics';
import { IconMinus, IconPlus } from '../../ui/icons';

export function StockPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');

  useEffect(() => {
    void ensureInventory().catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load stock'),
    );
  }, []);

  const shown = CATEGORIES.filter((c) => !c.legacy);
  const joints = shown.filter((c) => !c.id.startsWith('cookie_'));
  const cookies = shown.filter((c) => c.id.startsWith('cookie_'));
  const editCat = editId ? CATEGORIES.find((c) => c.id === editId) : null;

  async function bump(id: string, delta: number) {
    setBusy(id);
    try {
      await adjustInventory(id, delta);
      haptic(10);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Stock update failed');
    } finally {
      setBusy(null);
    }
  }

  async function saveCount() {
    if (!editId) return;
    setBusy(editId);
    try {
      await setInventoryCount(editId, Number(editQty) || 0);
      haptic(10);
      setEditId(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Stock update failed');
    } finally {
      setBusy(null);
    }
  }

  function Row({ id, name, color }: { id: string; name: string; color: string }) {
    const qty = inventory.value[id] || 0;
    const level = stockLevel(id, qty);
    return (
      <div class="stock-row">
        <FlavorDot color={color} hollow={level === 'out'} size="lg" />
        <div class="stock-row__label">
          <div class="stock-row__name">{name}</div>
          {level !== 'ok' ? <Tag tone={level === 'low' ? 'low' : 'out'}>{level}</Tag> : null}
        </div>
        <button
          type="button"
          class="stock-row__qty"
          data-testid={`stock-${id}-qty`}
          aria-label={`Set count for ${name}`}
          onClick={() => {
            setEditId(id);
            setEditQty(String(qty));
          }}
        >
          {qty}
        </button>
        <div class="stepper">
          <button
            type="button"
            disabled={busy === id || qty <= 0}
            aria-label={`Decrease ${name}`}
            data-testid={`stock-${id}-dec`}
            onClick={() => void bump(id, -1)}
          >
            <IconMinus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={busy === id}
            aria-label={`Increase ${name}`}
            data-testid={`stock-${id}-inc`}
            onClick={() => void bump(id, 1)}
          >
            <IconPlus size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section>
      <h1 class="page-title">Stock</h1>
      <p class="v-muted" data-testid="stock-glance">
        {(() => {
          const glance = stockGlance(shown.map((c) => stockLevel(c.id, inventory.value[c.id] || 0)));
          return `${glance.out} out · ${glance.low} low · ${glance.ok} ok`;
        })()}
      </p>
      {!inventoryReady.value ? <p class="v-muted">Loading…</p> : null}
      <div class="v-section-label">Joints</div>
      <div class="stock-grid">
        {joints.map((c) => (
          <Row key={c.id} id={c.id} name={c.sub ? `${c.name} ${c.sub}` : c.name} color={c.color} />
        ))}
      </div>
      <div class="v-section-label">Cookies</div>
      <div class="stock-grid">
        {cookies.map((c) => (
          <Row key={c.id} id={c.id} name={c.name} color={c.color} />
        ))}
      </div>

      <Sheet
        open={Boolean(editId)}
        title={editCat ? `Set ${editCat.name}` : 'Set count'}
        onClose={() => setEditId(null)}
        footer={
          <Button size="xl" data-testid="stock-set-confirm" onClick={() => void saveCount()}>
            Save count
          </Button>
        }
      >
        <Field
          label="Count"
          inputMode="numeric"
          data-testid="stock-set-count"
          value={editQty}
          onInput={(e) => setEditQty((e.target as HTMLInputElement).value)}
        />
        <div class="v-chip-row" style={{ marginTop: 12 }}>
          {[6, 12, 24, 48].map((n) => (
            <button key={n} type="button" class="v-tag" onClick={() => setEditQty(String(n))}>
              {n}
            </button>
          ))}
          <button
            type="button"
            class="v-tag"
            data-testid="stock-bulk-24"
            onClick={() => setEditQty(String((Number(editQty) || 0) + 24))}
          >
            +24
          </button>
        </div>
      </Sheet>
    </section>
  );
}
