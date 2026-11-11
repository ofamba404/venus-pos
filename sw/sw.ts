/**
 * Service worker source for /next (Phase 6).
 * Built later to /next/sw.js — do NOT register under /next/ until Phase 10.
 */

export const CACHE_PREFIX = 'venus-next-';

export type RouteDecision =
  | { action: 'network-only' }
  | { action: 'cache-first'; cache: string }
  | { action: 'network-first'; cache: string };

export function decideRoute(url: URL, cacheVersion: string): RouteDecision {
  const cache = `${CACHE_PREFIX}${cacheVersion}`;
  const path = url.pathname;

  if (path.startsWith('/api/') || path.includes('supabase')) {
    return { action: 'network-only' };
  }
  if (/\.(?:js|css|woff2?|png|jpg|jpeg|webp|svg)$/i.test(path)) {
    return { action: 'cache-first', cache };
  }
  if (path.startsWith('/next/')) {
    return { action: 'network-first', cache };
  }
  return { action: 'network-only' };
}

export function shouldSkipWaiting(cartEmpty: boolean): boolean {
  return cartEmpty;
}
