/**
 * Bulk pricing for flavored cookies (chocolate, mint, strawberry).
 * Mirrors venus-store/js/shared/flavored-cookie-pricing.js so POS manual
 * orders match storefront: any mix of singles + flavored cookies inside
 * packs totaling ≥ 4 unlocks:
 *   - Singles: UGX 8,000 → 6,250 (~22% off)
 *   - Packs: 6,250 × flavored cookies in the pack
 * Butterscotch singles and non-cookie lines are never discounted.
 */

import { cookieUnitPrice } from './config.js';

const FLAVOR_BREAKDOWN_KEYS = new Set([
  'cookie_chocolate',
  'cookie_mint',
  'cookie_strawberry',
]);

const PACK_IDS = new Set(['cookie_duet', 'cookie_trio', 'cookie_quartet']);

/** Fallback cookies-per-pack when breakdown is missing (quartet: 3 flavored + butterscotch). */
const PACK_FLAVORED_COOKIES = {
  cookie_duet: 2,
  cookie_trio: 3,
  cookie_quartet: 3,
};

const PACK_BASE_UGX = {
  cookie_duet: 15000,
  cookie_trio: 21000,
  cookie_quartet: 25000,
};

const SINGLE_UNIT_UGX = 8000;
/** Exact bulk unit: 21.875% off 8,000 → 6,250. Badge/copy round to 22%. */
const SINGLE_BULK_UGX = 6250;
const THRESHOLD = 4;

export function isCookiePackProduct(productId) {
  return PACK_IDS.has(String(productId || ''));
}

export function isCookieSingleProduct(productId) {
  return String(productId || '') === 'cookie_single';
}

export function isCookiePricedProduct(productId) {
  const id = String(productId || '');
  return id === 'cookie_single' || PACK_IDS.has(id);
}

function breakdownFlavoredCookies(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return Object.entries(breakdown).reduce((sum, [key, qty]) => {
    if (!FLAVOR_BREAKDOWN_KEYS.has(String(key))) return sum;
    return sum + Math.max(0, Math.floor(Number(qty) || 0));
  }, 0);
}

/** Flavored cookies in one pack unit (breakdown preferred; fallback only if missing). */
export function flavoredCookiesPerPack(productId, breakdown) {
  if (breakdown && typeof breakdown === 'object') {
    const fromBreakdown = breakdownFlavoredCookies(breakdown);
    if (fromBreakdown > 0) return fromBreakdown;
    // Empty selection while configuring — don't invent pack cookies yet.
    if (Object.keys(breakdown).length === 0) return 0;
    // Breakdown present but no flavored cookies (e.g. butterscotch only).
    return 0;
  }
  return PACK_FLAVORED_COOKIES[String(productId || '')] || 0;
}

function lineProductId(line) {
  return String(line?.productId || line?.product_id || '');
}

/** How many flavored (choc/mint/strawb) cookies one cart/sale line contributes. */
export function cookiesInLine(line) {
  if (!line || line.isReward || line.is_reward || line.rewardKey || line.reward_key) return 0;
  const id = lineProductId(line);
  const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));

  if (id === 'cookie_single') {
    return breakdownFlavoredCookies(line.breakdown);
  }

  if (PACK_IDS.has(id)) {
    return flavoredCookiesPerPack(id, line.breakdown) * qty;
  }

  return 0;
}

/**
 * @param {Array<object>} lines
 * @param {{ excludeKey?: string, excludeProductId?: string }} [options]
 */
export function sumFlavoredCookies(lines, options = {}) {
  const excludeKey = options.excludeKey != null ? String(options.excludeKey) : '';
  const excludeProductId = options.excludeProductId
    ? String(options.excludeProductId)
    : '';
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
    if (!line) return sum;
    if (excludeKey && String(line.key || '') === excludeKey) return sum;
    if (excludeProductId && lineProductId(line) === excludeProductId) return sum;
    return sum + cookiesInLine(line);
  }, 0);
}

export function unitPriceUgx(combinedCookieCount) {
  return (Number(combinedCookieCount) || 0) >= THRESHOLD ? SINGLE_BULK_UGX : SINGLE_UNIT_UGX;
}

export function packBaseUgx(productId) {
  return PACK_BASE_UGX[String(productId || '')] || 0;
}

/**
 * Pack line UGX. Below threshold: catalog. At 4+: 6,250 × flavored cookies in pack.
 */
export function packPriceUgx(productId, combinedCookieCount, breakdown) {
  const base = packBaseUgx(productId);
  if (!base) return 0;
  if ((Number(combinedCookieCount) || 0) < THRESHOLD) return base;
  const flavored = flavoredCookiesPerPack(productId, breakdown);
  if (!flavored) return base;
  return SINGLE_BULK_UGX * flavored;
}

/** Ala-carte / bulk total for a cookie_single breakdown at a given cart flavored count. */
export function singleLineTotalUgx(breakdown, combinedCookieCount) {
  const flavoredUnit = unitPriceUgx(combinedCookieCount);
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return Object.entries(breakdown).reduce((sum, [catId, qtyRaw]) => {
    const qty = Math.max(0, Math.floor(Number(qtyRaw) || 0));
    if (!qty) return sum;
    if (FLAVOR_BREAKDOWN_KEYS.has(String(catId))) {
      return sum + qty * flavoredUnit;
    }
    return sum + qty * cookieUnitPrice(catId);
  }, 0);
}

/**
 * Line total for a product + selection given other cart/sale lines.
 * @param {object} product
 * @param {object} breakdown
 * @param {Array<object>} otherLines
 */
export function lineTotalForCookieProduct(product, breakdown, otherLines = []) {
  const id = String(product?.id || '');
  const draftLine = { productId: id, breakdown, quantity: 1 };
  const combined = sumFlavoredCookies(otherLines) + cookiesInLine(draftLine);

  if (id === 'cookie_single') {
    return singleLineTotalUgx(breakdown, combined);
  }
  if (PACK_IDS.has(id)) {
    return packPriceUgx(id, combined, breakdown);
  }
  return product?.price ?? 0;
}

/**
 * Reprice cookie singles + packs from combined flavored-cookie count.
 * Mutates lines in place (uses `lineTotal` or `line_total`).
 * @returns {boolean} whether any line changed
 */
export function applyToCartLines(lines) {
  if (!Array.isArray(lines)) return false;
  const total = sumFlavoredCookies(lines);
  let changed = false;

  lines.forEach((line) => {
    if (!line || line.isReward || line.is_reward || line.rewardKey || line.reward_key) return;
    const id = lineProductId(line);
    let next = null;

    if (id === 'cookie_single') {
      next = singleLineTotalUgx(line.breakdown, total);
    } else if (PACK_IDS.has(id)) {
      const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
      next = packPriceUgx(id, total, line.breakdown) * qty;
    } else {
      return;
    }

    if (line.lineTotal != null) {
      if (line.lineTotal !== next) {
        line.lineTotal = next;
        changed = true;
      }
    } else if (line.line_total != null) {
      if (line.line_total !== next) {
        line.line_total = next;
        changed = true;
      }
    } else {
      line.lineTotal = next;
      changed = true;
    }
  });

  return changed;
}

export function getProgress(lines) {
  const count = sumFlavoredCookies(lines);
  const hasAny = count > 0;
  const unlocked = count >= THRESHOLD;
  const remaining = Math.max(0, THRESHOLD - count);
  const percent = Math.min(100, Math.round((count / THRESHOLD) * 100));

  let message = '';
  if (hasAny) {
    if (unlocked) {
      message = "You've gotten 22% off!";
    } else {
      const unit = remaining === 1 ? 'cookie' : 'cookies';
      message = `${remaining} more ${unit} to get 22% off`;
    }
  }

  return { count, remaining, percent, unlocked, hasAny, message, threshold: THRESHOLD };
}

/** Unit price label for a cookie category given current combined flavored count. */
export function cookieUnitPriceForCount(categoryId, combinedCookieCount) {
  if (FLAVOR_BREAKDOWN_KEYS.has(String(categoryId || ''))) {
    return unitPriceUgx(combinedCookieCount);
  }
  return cookieUnitPrice(categoryId);
}

export const FLAVORED_COOKIE_BULK_UGX = SINGLE_BULK_UGX;
export const FLAVORED_COOKIE_UNIT_UGX = SINGLE_UNIT_UGX;
export const FLAVORED_COOKIE_THRESHOLD = THRESHOLD;
