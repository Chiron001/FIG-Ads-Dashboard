// Section 4a (spec): exploratory correlation. Always render with "association,
// not causation" -- enforced by the type name/comment, actual label text
// lives in the API response and the UI, not duplicated here.

export interface CorrelationResult {
  r: number;
  n: number;
  strength: "weak" | "moderate" | "strong";
}

/** Pearson correlation. Guard: n >= 10 paired points (spec §4a) -- below
 * that, a correlation coefficient is just noise between two short series. */
export function pearsonCorrelation(xs: number[], ys: number[]): CorrelationResult | null {
  if (xs.length !== ys.length || xs.length < 10) return null;

  const n = xs.length;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX) * Math.sqrt(denomY);
  if (denom === 0) return null; // one series is constant -- correlation undefined, not 0

  const r = numerator / denom;
  const abs = Math.abs(r);
  const strength = abs > 0.7 ? "strong" : abs >= 0.3 ? "moderate" : "weak";
  return { r, n, strength };
}
