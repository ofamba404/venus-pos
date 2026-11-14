import { signal } from '@preact/signals';
import type { SaleSummaryLine } from '../domain/sale-summary';

export type { SaleSummaryLine };

export type SaleSuccess = {
  id: number;
  /** Grand total: items plus delivery fee when there is one. */
  total: number;
  /** Who the sale was for. "Walk-in" when no client was named. */
  client: string;
  credit: boolean;
  queued: boolean;
  /** The delivery trip is still being written. */
  savingDelivery: boolean;
  /** Item lines for the compact summary. */
  lines: SaleSummaryLine[];
  /** Delivery fee when this sale had delivery. Null when it did not. */
  fee: number | null;
};

/** The sale that was just recorded, or null. One at a time: a newer sale replaces the one on screen. */
export const saleSuccess = signal<SaleSuccess | null>(null);
let seq = 0;

/** Shows the success sheet. When a delivery write is still running, the sheet says so until it settles. */
export function showSaleSuccess(info: Omit<SaleSuccess, 'id' | 'savingDelivery'>, delivery?: Promise<void>) {
  const id = ++seq;
  saleSuccess.value = { ...info, id, savingDelivery: Boolean(delivery) };
  if (delivery) {
    void delivery
      .catch(() => {})
      .then(() => {
        if (saleSuccess.value?.id === id) saleSuccess.value = { ...saleSuccess.value, savingDelivery: false };
      });
  }
}

export function dismissSaleSuccess() {
  saleSuccess.value = null;
}
