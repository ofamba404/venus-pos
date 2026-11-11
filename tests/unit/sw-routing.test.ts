import { describe, expect, it } from 'vitest';
import { decideRoute, shouldSkipWaiting } from '../../sw/sw';

describe('next SW routing', () => {
  it('keeps API and supabase on network', () => {
    expect(decideRoute(new URL('https://x/api/inventory/write'), '1').action).toBe('network-only');
  });

  it('cache-first for static assets', () => {
    expect(decideRoute(new URL('https://x/next/assets/app.js'), '1').action).toBe('cache-first');
  });

  it('network-first for /next pages', () => {
    expect(decideRoute(new URL('https://x/next/sell'), '1').action).toBe('network-first');
  });

  it('only activates waiting worker when cart empty', () => {
    expect(shouldSkipWaiting(true)).toBe(true);
    expect(shouldSkipWaiting(false)).toBe(false);
  });
});
