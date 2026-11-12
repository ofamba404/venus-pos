import { flavorSwatchLayout, type FlavorSwatch } from '../domain/flavor-swatches';

function isLight(color: string) {
  const value = color.trim().toLowerCase();
  return value === '#fff' || value === '#ffffff';
}

function Swatch({ entry }: { entry: FlavorSwatch }) {
  const title = entry.qty > 1 ? `${entry.name} ×${entry.qty}` : entry.name;
  return (
    <span
      class={`v-swatch${isLight(entry.color) ? ' v-swatch--bordered' : ''}`}
      role="listitem"
      style={{ '--swatch': entry.color } as Record<string, string>}
      title={title}
    >
      <span class="v-swatch__dot" aria-hidden="true" />
      {entry.qty > 1 ? <span class="v-swatch__qty">×{entry.qty}</span> : null}
    </span>
  );
}

/** One filled circle per flavour. The readable list is the aria-label, not on-screen text. */
export function FlavorSwatches({
  breakdown,
  productId,
}: {
  breakdown?: Record<string, unknown> | null;
  productId?: string | null;
}) {
  const layout = flavorSwatchLayout(breakdown, productId);
  if (!layout.visible.length && !layout.plain) return null;
  return (
    <div class="v-swatches" role="list" aria-label={layout.label} title={layout.label}>
      {layout.visible.map((entry) => (
        <Swatch key={entry.id} entry={entry} />
      ))}
      {layout.overflow > 0 ? (
        <span class="v-swatch-more" role="listitem" title={layout.label}>
          +{layout.overflow}
        </span>
      ) : null}
      {layout.separatePlain ? <span class="v-swatch-sep" aria-hidden="true" /> : null}
      {layout.plain ? <Swatch entry={layout.plain} /> : null}
    </div>
  );
}
