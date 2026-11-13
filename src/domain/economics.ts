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

/**
 * The day the helper started (YYYY-MM-DD, Kampala). Sales do not record who made them, so this is how Insights
 * knows which days had a helper. Before it, the owner keeps everything. Unset means the helper counts on every day.
 * The data layer sets it from a saved setting.
 */
export const helperConfig: { since: string | null } = { since: null };

/** Kampala calendar day (YYYY-MM-DD) of a timestamp. Kampala is UTC+3 all year. */
export function kampalaDay(iso: string | null | undefined): string {
  const t = new Date(iso || 0).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Did the helper work the day of this sale? True for every day when no start date is set. */
export function helperWorked(createdAt: string | null | undefined, since: string | null = helperConfig.since): boolean {
  if (!since) return true;
  return kampalaDay(createdAt) >= since;
}
