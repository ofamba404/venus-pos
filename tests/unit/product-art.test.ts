import { afterEach, describe, expect, it, vi } from 'vitest';
import { productImageSlides, productImageSrc } from '../../src/domain/product-art';

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

describe('flavour photo slides', () => {
  const names = (list: Array<{ src: string }>) => list.map((s) => s.src.split('/').pop());

  it('gives a pack one slide per flavour, in the order they were picked, with counts', () => {
    const slides = productImageSlides('pilot', { mint: 2, grape: 1, strawberry: 3 });
    expect(names(slides)).toEqual(['pilot-mint.webp', 'pilot-grape.webp', 'pilot-strawberry.webp']);
    expect(slides.map((s) => s.count)).toEqual([2, 1, 3]);
    expect(names(productImageSlides('commander', { mint: 1, coconut: 1 }))).toEqual([
      'commanders-mint.webp',
      'commanders-coconut.webp',
    ]);
  });

  it('keeps a variety pack on scout flavour photos and its plain joint on the plain photo', () => {
    expect(names(productImageSlides('variety', { mint: 7, classic: 1 }))).toEqual([
      'scout-mint.webp',
      'bestsellers-plain.webp',
    ]);
  });

  it('uses cookie flavour photos for cookie packs and skips internal keys and zeros', () => {
    expect(names(productImageSlides('cookie_trio', { cookie_mint: 1, cookie_chocolate: 2 }))).toEqual([
      'mint-cookie.webp',
      'chocolate-cookie.webp',
    ]);
    expect(names(productImageSlides('scout', { _unitPrice: 5, mint: 0, grape: 1 }))).toEqual(['scout-grape.webp']);
  });

  it('falls back to the generic photo, or nothing, when no flavour has a photo', () => {
    expect(names(productImageSlides('scout'))).toEqual(['scout-pack.webp']);
    expect(names(productImageSlides('pilot', { nope: 1 }))).toEqual(['bestsellers-pilot-pack.webp']);
    expect(productImageSlides('cookie_quartet', { cookie_mint: 1 })).toEqual([
      { src: expect.stringContaining('mint-cookie.webp'), count: 1 },
    ]);
    expect(productImageSlides('cookie_quartet')).toEqual([]);
    expect(productImageSlides(null)).toEqual([]);
  });

  it('merges flavours that share a photo', () => {
    const slides = productImageSlides('cookie_trio', { cookie: 1, cookie_butterscotch: 2 });
    expect(slides).toHaveLength(1);
    expect(slides[0]!.count).toBe(3);
  });
});
