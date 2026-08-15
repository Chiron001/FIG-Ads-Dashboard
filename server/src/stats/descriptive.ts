// Section 1 (spec): distribution & reliability. Every guard here matches
// the spec's table exactly -- n >= 1 for mean/median, n >= 2 for stddev/CV,
// n >= 4 for IQR. Divide-by-zero and insufficient-n both return null, never
// 0/NaN/Infinity (spec §8, enforced globally).

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sample standard deviation (n-1 denominator). Needs n >= 2 -- a single
 * point has no spread to measure. */
export function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** The "reliability" score (spec §1) -- stddev/mean. Null on n<2 or mean=0
 * (a zero-mean series has no meaningful relative spread). */
export function coefficientOfVariation(values: number[]): number | null {
  const m = mean(values);
  const sd = sampleStdDev(values);
  if (m == null || sd == null || m === 0) return null;
  return sd / m;
}

export type ReliabilityLabel = "Stable" | "Variable" | "Volatile";

/** CV < 0.25 = Stable, 0.25-0.5 = Variable, > 0.5 = Volatile (spec §1). */
export function reliabilityLabel(cv: number | null): ReliabilityLabel | null {
  if (cv == null) return null;
  if (cv < 0.25) return "Stable";
  if (cv <= 0.5) return "Variable";
  return "Volatile";
}

export interface IQRResult {
  q1: number;
  q3: number;
  iqr: number;
}

// Linear-interpolation percentile (the common convention, matches numpy's
// default "linear" method) -- values must already be sorted ascending.
function percentile(sortedValues: number[], p: number): number {
  const idx = p * (sortedValues.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  const frac = idx - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * frac;
}

/** Needs n >= 4 -- quartiles on fewer points aren't meaningful. */
export function iqr(values: number[]): IQRResult | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  return { q1, q3, iqr: q3 - q1 };
}

/** Flags "trust the median, not the mean" (spec §1: mean > 1.5x median). */
export function isRightSkewed(values: number[]): boolean {
  const m = mean(values);
  const med = median(values);
  if (m == null || med == null || med === 0) return false;
  return m > 1.5 * med;
}
