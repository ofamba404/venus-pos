import { signal } from '@preact/signals';
import { helperConfig } from '../domain/economics';
import { KEYS } from './keys';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function read(): string | null {
  try {
    const raw = localStorage.getItem(KEYS.helperSince);
    return raw && DAY.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The day the helper started, saved on this phone. Sales do not record who made them, so before this day Insights
 * gives the helper nothing. Empty means the helper counts on every day. Read `.value` so a screen updates when it changes.
 */
export const helperSince = signal<string | null>(read());
helperConfig.since = helperSince.value;

export function setHelperSince(day: string | null) {
  const next = day && DAY.test(day) ? day : null;
  helperSince.value = next;
  helperConfig.since = next;
  try {
    if (next) localStorage.setItem(KEYS.helperSince, next);
    else localStorage.removeItem(KEYS.helperSince);
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
}
