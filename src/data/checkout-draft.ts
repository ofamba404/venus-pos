import { signal } from '@preact/signals';
import type { CheckoutDeliveryInput } from '../domain/sale-payload';
import { KEYS } from './keys';

export type CheckoutDraft = CheckoutDeliveryInput & {
  feeManuallyEdited?: boolean;
  predictedFee?: number | null;
};

const empty: CheckoutDraft = {
  dest: null,
  destText: '',
  feeValue: '',
  distanceKm: null,
  durationMin: null,
  feeManuallyEdited: false,
  predictedFee: null,
};

function read(): CheckoutDraft {
  try {
    const raw = sessionStorage.getItem(KEYS.fulfillment);
    return raw ? { ...empty, ...(JSON.parse(raw) as CheckoutDraft) } : { ...empty };
  } catch {
    return { ...empty };
  }
}

export const checkoutDraft = signal<CheckoutDraft>(
  typeof sessionStorage !== 'undefined' ? read() : { ...empty },
);

function persist(next: CheckoutDraft) {
  checkoutDraft.value = next;
  try {
    sessionStorage.setItem(KEYS.fulfillment, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

export function setCheckoutDraft(patch: Partial<CheckoutDraft>) {
  persist({ ...checkoutDraft.value, ...patch });
}

export function replaceCheckoutDraft(next: CheckoutDraft) {
  persist({ ...empty, ...next });
}

export function clearCheckoutDraft() {
  persist({ ...empty });
}
