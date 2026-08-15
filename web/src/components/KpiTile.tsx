interface Props {
  label: string;
  value: string;
  sublabel?: string;
  accent?: string; // CSS color for a left rule, ties the tile to its platform
  /** % change vs the comparison period, e.g. 0.124 = +12.4%. Undefined = no comparison active; null = comparison active but undefined (e.g. zero denominator). */
  delta?: number | null;
  deltaLabel?: string; // e.g. "vs previous period"
}

export function KpiTile({ label, value, sublabel, accent, delta, deltaLabel }: Props) {
  return (
    <div
      className="rounded-lg border border-border bg-surface-1 px-4 py-3"
      style={accent ? { borderLeftColor: accent, borderLeftWidth: "3px" } : undefined}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-ink-primary tabular-nums">{value}</div>
      {sublabel && <div className="mt-0.5 text-xs text-ink-secondary tabular-nums">{sublabel}</div>}
      {delta !== undefined && (
        <div className="mt-1 flex items-center gap-1 text-xs tabular-nums">
          {delta == null ? (
            <span className="text-ink-muted">— {deltaLabel}</span>
          ) : (
            <span className={delta > 0 ? "text-status-good" : delta < 0 ? "text-status-critical" : "text-ink-muted"}>
              {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {delta >= 0 ? "+" : ""}
              {(delta * 100).toFixed(1)}% {deltaLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
