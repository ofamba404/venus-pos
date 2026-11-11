import { describe, expect, it } from 'vitest';
import { COOKIE_CHOICE_POOL, COOKIE_FLAVOR_POOL, SPLIFF_POOL } from '../../src/domain/catalog';
import { configFlavorPool, findProduct } from '../../src/domain/pricing/pack-config';

describe('config flavor pools', () => {
  it('lists cookie flavors for singles and wholesale', () => {
    expect(configFlavorPool(findProduct('cookie_single'))).toEqual(COOKIE_FLAVOR_POOL);
    expect(configFlavorPool(findProduct('cookie_wholesale'))).toEqual(COOKIE_FLAVOR_POOL);
  });

  it('lists bangis ratios for spliffs', () => {
    expect(configFlavorPool(findProduct('spliff_single'))).toEqual(SPLIFF_POOL);
  });

  it('keeps the quartet choice pool', () => {
    expect(configFlavorPool(findProduct('cookie_quartet'))).toEqual(COOKIE_CHOICE_POOL);
  });
});
