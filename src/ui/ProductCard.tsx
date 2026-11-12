/** A sellable product, not a text button. The photo is the way you tell packs apart. */
export function ProductCard({
  id,
  name,
  meta,
  price,
  image,
  kind,
  onClick,
}: {
  id: string;
  name: string;
  meta?: string;
  price: string;
  image?: string;
  kind: 'joint' | 'cookie';
  onClick: () => void;
}) {
  return (
    <button type="button" class="v-tile product-card" data-kind={kind} data-testid={`product-${id}`} onClick={onClick}>
      {image ? <img class="v-tile__img" src={image} alt="" /> : <span class="product-card__blank" aria-hidden="true" />}
      <span class="v-tile__name">{name}</span>
      {meta ? <span class="v-tile__meta">{meta}</span> : null}
      <span class="v-tile__price">{price}</span>
    </button>
  );
}
