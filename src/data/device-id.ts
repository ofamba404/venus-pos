import { KEYS } from './keys';

/** Stable id for this browser profile. Used so only one phone rings up a store order. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(KEYS.device);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now()}`;
    localStorage.setItem(KEYS.device, id);
    return id;
  } catch {
    return 'device-unknown';
  }
}
