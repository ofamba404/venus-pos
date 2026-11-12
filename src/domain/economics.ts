import { COOKIE_OWNER_SHARE } from './catalog';

/**
 * Rates the register decides with. Change them here.
 * Joint unit cost still comes from joint_cost_history, not from this file.
 */
export const ECONOMICS = {
  /** Helper's share of joint profit, and of the owner's cookie share. */
  helperShare: 0.4,
  /** Owner's share of cookie profit. The partner keeps the rest, including cost. */
  ownerCookieShare: COOKIE_OWNER_SHARE,
  /** How many days a restock order is meant to cover. */
  restockCycleDays: 14,
} as const;

export type Economics = {
  helperShare: number;
  ownerCookieShare: number;
  restockCycleDays: number;
};
