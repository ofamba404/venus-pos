import type { ComponentChildren } from 'preact';

/** Drop-off, phone, and time belong together. They were separate fields with no relationship. */
export function DeliveryBlock({ children }: { children: ComponentChildren }) {
  return (
    <section class="delivery-block" aria-label="Delivery">
      <div class="v-section-label">Delivery</div>
      {children}
    </section>
  );
}
