const PREFIX = 'venus-pos-cache:';
const FRESH_MS = 60_000;

export function readCache(key, maxAge = FRESH_MS) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (maxAge >= 0 && Date.now() - ts > maxAge) return null;
    return data;
  } catch {
    return null;
  }
}

export function readStaleCache(key) {
  return readCache(key, Infinity);
}

export function writeCache(key, data) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* storage full — skip */
  }
}

export function clearCache(key) {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function isCacheFresh(key) {
  return readCache(key) !== null;
}
