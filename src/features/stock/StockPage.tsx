import { useEffect, useState } from 'preact/hooks';
import { CATEGORIES } from '../../domain/catalog';
import { stockLevel } from '../../domain/stock-state';
import { adjustInventory, ensureInventory, inventory, inventoryReady } from '../../data/entities';
import { FlavorDot } from '../../ui/FlavorDot';
import { Tag } from '../../ui/Tag';
import { showToast } from '../../ui/ToastHost';
import { haptic } from '../../platform/haptics';
import { IconMinus, IconPlus } from '../../ui/icons';

export function StockPage() {
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void ensureInventory().catch((e) =>
      showToast(e instanceof Error ? e.message : 'Could not load stock'),
    );
  }, []);

  const joints = CATEGORIES.filter((c) => !c.id.startsWith('cookie_'));
  const cookies = CATEGORIES.filter((c) => c.id.startsWith('cookie_'));

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
        <span class="stock-row__qty">{qty}</span>
        <div class="stepper">
          <button
            type="button"
            disabled={busy === id || qty <= 0}
            aria-label={`Decrease ${name}`}
            onClick={() => void bump(id, -1)}
          >
            <IconMinus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={busy === id}
            aria-label={`Increase ${name}`}
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
    </section>
  );
}
