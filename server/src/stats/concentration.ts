// Section 6 (spec): concentration & contribution.

export interface ParetoInput {
  campaignId: string;
  campaignName: string | null;
  revenue: number;
  /** Carried through untouched -- lets the frontend re-sort/re-cumulate
   * this same point set by spend instead of revenue without a second
   * endpoint. Ranking here is still always by revenue (spec §6a). */
  spend: number;
}

export interface ParetoPoint extends ParetoInput {
  cumulativePct: number;
}

export interface ParetoResult {
  /** How many top-revenue campaigns it takes to reach 80% of total revenue. */
  campaignsToEightyPercent: number;
  totalCampaigns: number;
  points: ParetoPoint[];
}

/** Sorts by revenue desc, walks the cumulative % curve, and finds where it
 * crosses 80% (spec §6a). With zero total revenue, every campaign
 * "contributes" undefined % -- returns 0 cumulativePct throughout rather
 * than dividing by zero. */
export function paretoAnalysis(campaigns: ParetoInput[]): ParetoResult {
  const sorted = [...campaigns].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((sum, c) => sum + c.revenue, 0);

  let cumulative = 0;
  let crossed = false;
  let campaignsToEightyPercent = sorted.length;

  const points: ParetoPoint[] = sorted.map((c, i) => {
    cumulative += c.revenue;
    const cumulativePct = total > 0 ? cumulative / total : 0;
    if (!crossed && cumulativePct >= 0.8) {
      crossed = true;
      campaignsToEightyPercent = i + 1;
    }
    return { ...c, cumulativePct };
  });

  return { campaignsToEightyPercent, totalCampaigns: sorted.length, points };
}

export interface ContributionInput {
  campaignId: string;
  campaignName: string | null;
  revenue: number;
  spend: number;
}

export interface ContributionRow extends ContributionInput {
  contribution: number;
  /** % of the portfolio's total contribution -- null if the portfolio nets to exactly 0. */
  pctOfTotal: number | null;
}

/** Ranks by absolute profit contribution (revenue*margin - spend), not
 * ROAS -- spec §6b: this is what stops a high-ROAS-but-tiny-spend campaign
 * from looking more important than it is. */
export function contributionRanking(campaigns: ContributionInput[], grossMargin: number): ContributionRow[] {
  const withContribution = campaigns.map((c) => ({ ...c, contribution: c.revenue * grossMargin - c.spend }));
  const total = withContribution.reduce((sum, c) => sum + c.contribution, 0);

  return withContribution
    .map((c) => ({ ...c, pctOfTotal: total !== 0 ? c.contribution / total : null }))
    .sort((a, b) => b.contribution - a.contribution);
}

/**
 * Return on the *next rupee* of spend, not the blended average (spec §6c).
 * Guard: if spend didn't increase period-over-period, marginal analysis
 * doesn't apply (you can't attribute a revenue change to "more spend" when
 * spend didn't go up) -- returns null, not a divide-by-negative-or-zero result.
 */
export function marginalRoas(revenueCurrent: number, spendCurrent: number, revenuePrior: number, spendPrior: number): number | null {
  const deltaSpend = spendCurrent - spendPrior;
  if (deltaSpend <= 0) return null;
  return (revenueCurrent - revenuePrior) / deltaSpend;
}
