const COOKIE_COLORS = ['#D4A355', '#5c2e1f', '#3CB043', '#d81e2c'];

/** Quartet is a stack. Wholesale is the flavour set. Neither has a catalog photo. */
function CookieArt({ mode }: { mode: 'stack' | 'swatches' }) {
  return (
    <span class={`tile-art tile-art--${mode}`} aria-hidden="true">
      {COOKIE_COLORS.map((color) => (
        <i key={color} style={{ background: color }} />
      ))}
    </span>
  );
}

/** A sellable product, not a text button. The photo is the way you tell packs apart. */
export function ProductCard({
  id,
  name,
  meta,
  price,
  image,
  art,
  kind,
  onClick,
}: {
  id: string;
  name: string;
  meta?: string;
  price: string;
  image?: string;
  art?: 'stack' | 'swatches';
  kind: 'joint' | 'cookie';
  onClick: () => void;
}) {
  return (
    <button type="button" class="v-tile product-card" data-kind={kind} data-testid={`product-${id}`} onClick={onClick}>
      {image ? <img class="v-tile__img" src={image} alt="" /> : art ? <CookieArt mode={art} /> : <span class="product-card__blank" aria-hidden="true" />}
      <span class="v-tile__name">{name}</span>
      {meta ? <span class="v-tile__meta">{meta}</span> : null}
      <span class="v-tile__price">{price}</span>
    </button>
  );
}
