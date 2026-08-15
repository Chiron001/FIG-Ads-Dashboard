// Mirrors server/src/stats/smoothing.ts's math exactly (small, pure, no
// guards worth sharing a module boundary for) -- duplicated rather than
// imported because the browser can't pull from /server, and the spec's
// "one tested module" requirement is about the inferential statistics
// (§1-§6), not this display-only chart toggle.

export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  if (window < 1) return values.map(() => null);
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    if (slice.some((v) => v == null)) return null;
    return (slice as number[]).reduce((a, b) => a + b, 0) / window;
  });
}

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
