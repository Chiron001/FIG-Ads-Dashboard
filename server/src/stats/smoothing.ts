// Section 5 (spec): trend vs noise. WoW/MoM growth is deliberately not
// duplicated here -- it's already delivered by the KPI comparison feature
// (web/src/lib/comparisonRange.ts), which shifts by the exact period
// length and so already lands on the same day-of-week for any 7-day range.
// This module covers what that feature doesn't: smoothing the trend line
// itself.

/** Simple moving average over a fixed trailing window. Returns null for the
 * first (window-1) points (not enough history yet) and for any point whose
 * window contains a gap (null value) -- never silently drops to a shorter
 * window, which would understate/overstate depending on what's missing. */
export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  if (window < 1) return values.map(() => null);
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    if (slice.some((v) => v == null)) return null;
    return (slice as number[]).reduce((a, b) => a + b, 0) / window;
  });
}

/**
 * Exponentially weighted moving average -- reacts faster to recent changes
 * than a flat moving average. alpha closer to 1 = more weight on the
 * newest point. Holds the last computed value through a gap (null) rather
 * than resetting, since a single missing day shouldn't erase the trend.
 */
export function ewma(values: (number | null)[], alpha = 0.3): (number | null)[] {
  const result: (number | null)[] = [];
  let prev: number | null = null;
  for (const v of values) {
    if (v == null) {
      result.push(prev);
      continue;
    }
    prev = prev == null ? v : alpha * v + (1 - alpha) * prev;
    result.push(prev);
  }
  return result;
}
