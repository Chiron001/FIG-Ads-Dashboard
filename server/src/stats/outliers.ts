// Section 2 (spec): outlier/anomaly detection, per campaign-day.

import { iqr, mean, sampleStdDev } from "./descriptive";

export interface OutlierFlag<T> {
  item: T;
  value: number;
  direction: "high" | "low";
  /** How far outside the fence/threshold it sat -- surfaced in the UI so the
   * analyst sees magnitude, not just a boolean flag. */
  fenceDistance: number;
}

/** Tukey's method, robust to skew -- the default per spec §2. Needs n >= 8
 * daily points to be meaningful; below that, returns no flags rather than
 * flagging noise. */
export function iqrOutliers<T>(items: T[], getValue: (item: T) => number): OutlierFlag<T>[] {
  if (items.length < 8) return [];
  const values = items.map(getValue);
  const bounds = iqr(values);
  if (!bounds) return [];

  const lowerFence = bounds.q1 - 1.5 * bounds.iqr;
  const upperFence = bounds.q3 + 1.5 * bounds.iqr;
  const flags: OutlierFlag<T>[] = [];
  items.forEach((item, i) => {
    const v = values[i];
    if (v < lowerFence) flags.push({ item, value: v, direction: "low", fenceDistance: lowerFence - v });
    else if (v > upperFence) flags.push({ item, value: v, direction: "high", fenceDistance: v - upperFence });
  });
  return flags;
}

/** Secondary method (spec §2). Distorted by the very outliers it seeks --
 * an extreme value pulls the mean toward itself and inflates the stddev,
 * which can mask its own significance. That's why IQR (robust to skew) is
 * primary and this is offered only as a secondary cross-check. */
export function zScoreOutliers<T>(items: T[], getValue: (item: T) => number): OutlierFlag<T>[] {
  const values = items.map(getValue);
  const m = mean(values);
  const sd = sampleStdDev(values);
  if (m == null || sd == null || sd === 0) return [];

  const flags: OutlierFlag<T>[] = [];
  items.forEach((item, i) => {
    const z = (values[i] - m) / sd;
    if (Math.abs(z) > 2) flags.push({ item, value: values[i], direction: z > 0 ? "high" : "low", fenceDistance: Math.abs(z) });
  });
  return flags;
}
