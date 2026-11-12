import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../../src/domain/catalog';
import {
  configReady,
  configRemaining,
  configTarget,
} from '../../src/domain/pricing/pack-config';

const product = (id: string) => PRODUCTS.find((p) => p.id === id)!;

describe('pack flavour count', () => {
  it('knows how many flavours each pack takes', () => {
    expect(configTarget(product('scout'))).toBe(1);
    expect(configTarget(product('pilot'))).toBe(2);
    expect(configTarget(product('commander'))).toBe(5);
    // Variety is 8 slots: 7 flavoured, and the last is the fixed Plain.
    expect(configTarget(product('variety'))).toBe(7);
    expect(configTarget(product('cookie_duet'))).toBe(2);
    expect(configTarget(product('cookie_trio'))).toBe(3);
  });

  it('has no count for singles, Bangis, cookies and wholesale', () => {
    for (const id of ['plain_single', 'spliff_single', 'cookie_single', 'cookie_wholesale']) {
      expect(configTarget(product(id))).toBeNull();
      expect(configRemaining(product(id), { qty: 3 })).toBeNull();
    }
    expect(configTarget(null)).toBeNull();
    expect(configTarget({ ...product('scout'), joints: undefined })).toBe(0);
    expect(configTarget({ ...product('variety'), joints: undefined })).toBe(0);
  });

  it('counts the slots left and is ready only on the exact count', () => {
    const pilot = product('pilot');
    expect(configRemaining(pilot, {})).toBe(2);
    expect(configRemaining(pilot, { mint: 1 })).toBe(1);
    expect(configRemaining(pilot, { mint: 3 })).toBe(0);
    expect(configRemaining(pilot, null)).toBe(2);
    expect(configReady(pilot, { mint: 1 })).toBe(false);
    expect(configReady(pilot, { mint: 1, grape: 1 })).toBe(true);
    expect(configReady(pilot, { mint: 2, grape: 1 })).toBe(false);
    expect(configReady(product('variety'), { mint: 6 })).toBe(false);
    expect(configReady(product('variety'), { mint: 4, grape: 3 })).toBe(true);
  });

  it('needs at least one for things with no count', () => {
    expect(configReady(product('plain_single'), { qty: 0 })).toBe(false);
    expect(configReady(product('plain_single'), { qty: 2 })).toBe(true);
    expect(configReady(product('cookie_wholesale'), { _unitPrice: 2500 })).toBe(false);
    expect(configReady(product('cookie_wholesale'), { _unitPrice: 2500, cookie_mint: 1 })).toBe(true);
    expect(configReady(null, {})).toBe(false);
  });
});
