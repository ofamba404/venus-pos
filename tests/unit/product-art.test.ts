import { afterEach, describe, expect, it, vi } from 'vitest';
import { productImageSrc } from '../../src/domain/product-art';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('product photos', () => {
  it('uses a flavour pack photo only when the line is one pack flavour', () => {
    expect(productImageSrc('scout', { mint: 1 })).toContain('assets/products/scout-mint.webp');
    expect(productImageSrc('pilot', { grape: 2 })).toContain('assets/products/pilot-grape.webp');
    expect(productImageSrc('commander', { strawberry: 5 })).toContain(
      'assets/products/commanders-strawberry.webp',
    );
    expect(productImageSrc('scout', { mint: 0, watermelon: 1 })).toContain('scout-watermelon.webp');
    expect(productImageSrc('scout', { mint: 1, grape: 1 })).toContain('scout-pack.webp');
    expect(productImageSrc('scout', { classic: 1 })).toContain('scout-pack.webp');
    expect(productImageSrc('scout')).toContain('scout-pack.webp');
    expect(productImageSrc('variety', { mint: 7, classic: 1 })).toContain('bestsellers-variety-pack.jpg');
    expect(productImageSrc('pilot', { nope: 1 })).toContain('bestsellers-pilot-pack.webp');
  });

  it('keeps cookie singles on their flavour file and skips products with no art', () => {
    expect(productImageSrc('cookie_single', { cookie_mint: 2 })).toContain('mint-cookie.webp');
    expect(productImageSrc('cookie_single', { cookie_chocolate: 1, cookie_mint: 1 })).toContain(
      'bestsellers-cookie.jpg',
    );
    expect(productImageSrc('cookie_single', { cookie_nope: 1 })).toContain('bestsellers-cookie.jpg');
    expect(productImageSrc('cookie_quartet')).toBe('');
    expect(productImageSrc(null)).toBe('');
    vi.stubEnv('BASE_URL', '/next');
    expect(productImageSrc('commander', { coconut: 1 })).toContain(
      '/next/assets/products/commanders-coconut.webp',
    );
    vi.stubEnv('BASE_URL', '');
    expect(productImageSrc('plain_single')).toContain('/assets/products/bestsellers-plain.webp');
  });
});
