/** Small inline "vs comparison" indicator -- ▲/▼ + signed %, colorblind-
 * safe (the arrow carries the direction, color is reinforcement only).
 * Reused everywhere comparison mode now reaches: KPI tiles already had
 * their own equivalent inline; this is the version tables/charts use. */
export function DeltaBadge({ value }: { value: number | null }) {
  if (value == null) return null;
  if (value === 0) return <span className="ml-1 text-[11px] text-ink-muted">·flat</span>;
  const up = value > 0;
  return (
    <span className={`ml-1 text-[11px] tabular-nums ${up ? "text-status-good" : "text-status-critical"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {(value * 100).toFixed(1)}%
    </span>
  );
}
