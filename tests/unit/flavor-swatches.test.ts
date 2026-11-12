import { describe, expect, it } from 'vitest';
import { flavorEntries, flavorSwatchLayout } from '../../src/domain/flavor-swatches';
import { buildLineFromConfig, findProduct, wholesaleUnitPriceFromItem } from '../../src/domain/pricing/pack-config';

describe('flavour dots', () => {
  it('uses the catalog colours and pins Plain after a divider on Variety', () => {
    const layout = flavorSwatchLayout(
      { mint: 1, grape: 1, blueberry: 1, watermelon: 1, classic: 4, nope: 2 },
      'variety',
    );
    expect(layout.visible.map((row) => [row.id, row.color])).toEqual([
      ['mint', '#8fd6f0'],
      ['grape', '#D5C7E8'],
      ['blueberry', '#3f5bb8'],
      ['watermelon', '#f4a6c1'],
    ]);
    expect(layout.plain).toMatchObject({ id: 'classic', color: '#e3cba7', qty: 4 });
    expect(layout.separatePlain).toBe(true);
    expect(layout.label).toBe('Mint, Grape, Blueberry, Watermelon, Plain ×4');
    expect(flavorEntries(null)).toEqual([]);
  });

  it('collapses past eight dots and leaves Plain inline when it is the only flavour', () => {
    const many = flavorSwatchLayout(
      {
        mint: 1,
        strawberry: 1,
        blueberry: 1,
        watermelon: 1,
        grape: 1,
        coconut: 1,
        melon: 1,
        classic: 1,
        spliff7030: 1,
      },
      'scout',
    );
    expect(many.visible).toHaveLength(8);
    expect(many.overflow).toBe(1);
    expect(many.plain).toBeNull();

    const onlyPlain = flavorSwatchLayout({ classic: 2 }, 'variety');
    expect(onlyPlain.separatePlain).toBe(false);
    expect(onlyPlain.plain?.qty).toBe(2);
    expect(onlyPlain.label).toBe('Plain ×2');
    expect(flavorSwatchLayout({ cookie_mint: 1, cookie_butterscotch: 1 }, 'cookie_quartet').plain?.id).toBe(
      'cookie_butterscotch',
    );
    expect(flavorSwatchLayout({ mint: 1 }, 'variety').plain).toBeNull();
    expect(flavorSwatchLayout({ mint: 0, grape: 1 }, null).label).toBe('Grape');
    expect(buildLineFromConfig(findProduct('scout')!, { nope: 1 }).detail).toContain('nope x1');
    expect(buildLineFromConfig(findProduct('spliff_single')!, { spliff7030: 0 }).detail).toBe('');
    expect(buildLineFromConfig(findProduct('cookie_single')!, { cookie_mint: 0 }).detail).toBe('');
    expect(wholesaleUnitPriceFromItem(null)).toBe(0);
    expect(wholesaleUnitPriceFromItem({ breakdown: { cookie_mint: 2 } })).toBe(0);
  });
});