import { KEYS } from '../data/keys';

function hapticsEnabled() {
  try {
    const raw = localStorage.getItem(KEYS.uiPrefs);
    if (!raw) return true;
    const prefs = JSON.parse(raw);
    return prefs?.haptics !== false;
  } catch {
    return true;
  }
}

export function haptic(ms = 10) {
  if (!hapticsEnabled()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
