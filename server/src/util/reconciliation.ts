import type { ReconciliationInfo } from "@fig/shared";

// Grain-separation guardrail (build spec §0/§6): campaign, product, and ad
// spend are three overlapping BREAKDOWNS of the same rupees, never additive
// slices. This is the one place that compares a grain's summed spend back
// to the campaign total it's a breakdown of -- callers pass the grain sum
// and the campaign sum for the SAME filter (same date range, same
// campaign_id if filtered), never a cross-grain sum of the two.
//
// A deviation far outside tolerance (e.g. ~100%, as if product spend and
// campaign spend had been added together instead of compared) is exactly
// the double-counting bug this function exists to catch -- see
// reconciliation.test.ts.
export function computeReconciliation(grainSpend: number, campaignSpend: number, tolerancePct: number): ReconciliationInfo {
  const deviationPct = campaignSpend > 0 ? Math.abs(grainSpend - campaignSpend) / campaignSpend : null;
  return {
    grainSpend,
    campaignSpend,
    deviationPct,
    // No campaign spend to compare against -> nothing to flag as
    // out-of-tolerance (divide-by-zero rule: null, not a false alarm).
    withinTolerance: deviationPct == null || deviationPct <= tolerancePct,
    tolerancePct,
  };
}
