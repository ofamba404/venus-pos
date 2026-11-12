/**
 * Effective-dated flavored joint cost. The live change is in
 * `joint_cost_history` (migration 20261111153700): 5,000 until
 * 2026-11-11 15:37 UTC, then 4,000. Past sales keep the earlier cost.
 */

export const FLAVORED_JOINT_IDS = [
  'mint',
  'strawberry',
  'blueberry',
  'watermelon',
  'grape',
  'coconut',
  'melon',
] as const;

export const FLAVORED_JOINT_COST_4000_FROM = '2026-11-11T15:37:00.000Z';

export type JointCostRow = {
  category_id: string;
  cost_ugx: number;
  effective_from: string;
};

export function jointCostAt(
  history: JointCostRow[] | null | undefined,
  categoryId: string,
  at: string | Date,
  fallback = 0,
): number {
  const when = new Date(at).getTime();
  if (!Number.isFinite(when)) return fallback;
  let bestFrom = -Infinity;
  let bestCost: number | null = null;
  for (const row of history || []) {
    if (row.category_id !== categoryId) continue;
    const from = new Date(row.effective_from).getTime();
    if (!Number.isFinite(from) || from > when || from < bestFrom) continue;
    bestFrom = from;
    bestCost = Math.max(0, Math.round(Number(row.cost_ugx) || 0));
  }
  return bestCost == null ? fallback : bestCost;
}
