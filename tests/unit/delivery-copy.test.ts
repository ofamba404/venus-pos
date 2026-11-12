import { describe, expect, it } from 'vitest';
import { copyAllText, copyLocationText, copyPhoneText, mapsLink } from '../../src/domain/delivery-copy';
import { lineCount } from '../../src/domain/line-count';

describe('delivery copy text', () => {
  it('gives nine digits with no country code', () => {
    expect(copyPhoneText('+256700333444')).toBe('700333444');
    expect(copyPhoneText('0700333444')).toBe('700333444');
    expect(copyPhoneText('')).toBe('');
  });

  it('builds a maps link only when both coordinates are real', () => {
    expect(mapsLink(0.33, 32.59)).toBe('https://www.google.com/maps/search/?api=1&query=0.33,32.59');
    expect(mapsLink('0.3328', '32.5897')).toContain('query=0.3328,32.5897');
    expect(mapsLink(null, 32.59)).toBe('');
    expect(mapsLink(0.33, undefined)).toBe('');
    expect(mapsLink('', '')).toBe('');
    expect(mapsLink('x', 'y')).toBe('');
  });

  it('copies the place exactly, then the link on its own line', () => {
    expect(copyLocationText({ place: '  Plot 14, Kololo ', lat: 0.33, lng: 32.59 })).toBe(
      'Plot 14, Kololo\nhttps://www.google.com/maps/search/?api=1&query=0.33,32.59',
    );
    expect(copyLocationText({ place: 'Near the old taxi park' })).toBe('Near the old taxi park');
    expect(copyLocationText({ lat: 1, lng: 2 })).toBe('https://www.google.com/maps/search/?api=1&query=1,2');
    expect(copyLocationText({})).toBe('');
  });

  it('copies all in a fixed order and leaves out what is missing', () => {
    expect(
      copyAllText({
        name: 'Bartholomew Nakimuli',
        phone: '+256700333444',
        place: 'Plot 14 Acacia Avenue, Kololo, Kampala',
        lat: 0.33,
        lng: 32.59,
        collect: 55000,
      }),
    ).toBe(
      [
        'Name: Bartholomew Nakimuli',
        'Phone: 700333444',
        'Drop-off: Plot 14 Acacia Avenue, Kololo, Kampala',
        'Map: https://www.google.com/maps/search/?api=1&query=0.33,32.59',
        'Collect: UGX 55,000',
      ].join('\n'),
    );
    expect(copyAllText({ name: 'A', phone: '0700111222', place: 'Ntinda', collect: 0 })).toBe(
      'Name: A\nPhone: 700111222\nDrop-off: Ntinda',
    );
    expect(copyAllText({})).toBe('');
  });
});

describe('line count', () => {
  it('reads a pack as one pack with joints inside', () => {
    expect(lineCount({ productId: 'variety', breakdown: { mint: 1, classic: 7 } })).toEqual({ qty: 1, contents: '8 joints' });
    expect(lineCount({ productId: 'scout', breakdown: { mint: 1 } })).toEqual({ qty: 1, contents: '1 joint' });
    expect(lineCount({ productId: 'cookie_duet', breakdown: { mint: 2 } })).toEqual({ qty: 1, contents: '2 cookies' });
    expect(lineCount({ productId: 'pilot', breakdown: {}, quantity: 3 })).toEqual({ qty: 3, contents: '2 joints' });
  });

  it('reads a single as a quantity with nothing inside', () => {
    expect(lineCount({ productId: 'plain_single', breakdown: { classic: 3 } })).toEqual({ qty: 3, contents: null });
    expect(lineCount({ productId: 'plain_single', breakdown: {} })).toEqual({ qty: 1, contents: null });
  });

  it('does not guess a quantity for a product it does not know', () => {
    expect(lineCount({ productId: 'cookie-duet', breakdown: { mint: 1, chocolate: 1 } })).toEqual({ qty: 1, contents: '2 items' });
    expect(lineCount({ productId: 'nope', breakdown: { mint: 1 } })).toEqual({ qty: 1, contents: null });
  });
});
