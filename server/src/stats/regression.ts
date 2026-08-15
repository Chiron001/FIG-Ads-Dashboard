// Section 4b (spec): diminishing-returns regression -- the highest
// budgeting value in this whole layer. Fits orders = a*ln(spend) + b (log
// captures the concave "each extra rupee buys fewer extra orders" shape),
// then derives the spend level where marginal ROAS crosses break-even.

export interface LinearFit {
  beta0: number;
  beta1: number;
  r2: number;
  n: number;
}

/** Ordinary least squares, y = beta0 + beta1*x. Guard: n >= 2 and x isn't
 * constant (no slope is estimable from a single x value). */
export function linearRegression(xs: number[], ys: number[]): LinearFit | null {
  if (xs.length !== ys.length || xs.length < 2) return null;

  const n = xs.length;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - xMean) * (ys[i] - yMean);
    sxx += (xs[i] - xMean) ** 2;
  }
  if (sxx === 0) return null;

  const beta1 = sxy / sxx;
  const beta0 = yMean - beta1 * xMean;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = beta0 + beta1 * xs[i];
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;

  return { beta0, beta1, r2, n };
}

export interface DiminishingReturnsResult {
  /** Fit is on (ln(spend), orders) pairs -- beta1 is "extra orders per unit of ln(spend)". */
  fit: LinearFit;
  /** r2 >= 0.3 -- below that, spend isn't the main driver and the model shouldn't be trusted (spec §4b). */
  reliable: boolean;
  /** Recommended spend ceiling: the point where marginal ROAS falls to break-even. Null if unreliable or the fit shows no diminishing-returns shape (beta1 <= 0). */
  budgetCeiling: number | null;
}

/**
 * orders = a*ln(spend) + b  =>  d(orders)/d(spend) = a/spend.
 * Marginal revenue per extra rupee = avgOrderValue * a/spend = marginal ROAS.
 * Setting marginal ROAS = breakEvenRoas and solving for spend:
 *   spend = avgOrderValue * a / breakEvenRoas
 *
 * Guard: n >= 14 daily points with spend > 0 (ln undefined at 0) -- spec §4b.
 */
export function diminishingReturnsFit(
  dailySpend: number[],
  dailyOrders: number[],
  avgOrderValue: number,
  breakEvenRoas: number
): DiminishingReturnsResult | null {
  if (dailySpend.length !== dailyOrders.length) return null;

  const pairs = dailySpend.map((s, i) => ({ spend: s, orders: dailyOrders[i] })).filter((p) => p.spend > 0);
  if (pairs.length < 14) return null;

  const xs = pairs.map((p) => Math.log(p.spend));
  const ys = pairs.map((p) => p.orders);
  const fit = linearRegression(xs, ys);
  if (!fit) return null;

  const reliable = fit.r2 >= 0.3;
  let budgetCeiling: number | null = null;
  if (reliable && fit.beta1 > 0 && breakEvenRoas > 0 && avgOrderValue > 0) {
    budgetCeiling = (avgOrderValue * fit.beta1) / breakEvenRoas;
  }

  return { fit, reliable, budgetCeiling };
}
