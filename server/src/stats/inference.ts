// Section 3 (spec): the significance layer -- confidence intervals and
// hypothesis tests. This is the highest-value piece: it tells the analyst
// whether a ROAS/CVR number is trustworthy or noise dressed up as a metric.

export type Confidence = "high" | "medium" | "low" | "insufficient";

/** Thresholds from spec §3a, keyed on clicks (the CI's actual sample size --
 * clicks, not conversions, since CVR = conversions/clicks and clicks is the
 * denominator whose size determines estimate precision). */
export function confidenceFromClicks(clicks: number): Confidence {
  if (clicks >= 1000) return "high";
  if (clicks >= 300) return "medium";
  if (clicks >= 100) return "low";
  return "insufficient";
}

export interface WilsonInterval {
  p: number;
  low: number;
  high: number;
  n: number;
  confidence: Confidence;
}

const Z_95 = 1.96;

/** Wilson score interval -- more accurate than Wald at small n (spec §3a
 * explicitly prefers this over the naive p ± 1.96*sqrt(p(1-p)/n) formula,
 * kept below only as a reference comment):
 *   Wald (NOT used): p ± 1.96 * sqrt(p*(1-p)/n)
 * Guard: n (clicks) >= 1. When confidence is "insufficient" the caller
 * should render "—", not these numbers -- they're returned anyway (rather
 * than null) so the confidence tag itself is always available to display. */
export function wilsonInterval(successes: number, n: number): WilsonInterval | null {
  if (n < 1) return null;
  const p = successes / n;
  const z = Z_95;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;

  return {
    p,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
    n,
    confidence: confidenceFromClicks(n),
  };
}

export interface TwoProportionTestResult {
  p1: number;
  p2: number;
  z: number;
  significant: boolean;
  verdict: string;
  conversions1: number;
  conversions2: number;
  /** "insufficient" -> verdict already explains why; caller shouldn't act on p1/p2/z. */
  confidence: "sufficient" | "insufficient";
}

/** Compares two campaigns' conversion rates (spec §3b). Gate: both need
 * >= 100 conversions each, else a clear "why" message instead of a verdict
 * built on too little data. */
export function twoProportionZTest(
  conversions1: number,
  clicks1: number,
  conversions2: number,
  clicks2: number
): TwoProportionTestResult {
  const p1 = clicks1 > 0 ? conversions1 / clicks1 : 0;
  const p2 = clicks2 > 0 ? conversions2 / clicks2 : 0;

  if (conversions1 < 100 || conversions2 < 100 || clicks1 <= 0 || clicks2 <= 0) {
    return {
      p1,
      p2,
      z: 0,
      significant: false,
      verdict: "Insufficient data to compare — need more conversions.",
      conversions1,
      conversions2,
      confidence: "insufficient",
    };
  }

  const pPool = (conversions1 + conversions2) / (clicks1 + clicks2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / clicks1 + 1 / clicks2));
  const z = se === 0 ? 0 : (p1 - p2) / se;
  const significant = Math.abs(z) > 1.96;

  return {
    p1,
    p2,
    z,
    significant,
    verdict: significant ? "Significant difference (95%)" : "No significant difference — likely noise.",
    conversions1,
    conversions2,
    confidence: "sufficient",
  };
}
