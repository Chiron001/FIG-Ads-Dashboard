interface Props {
  label: string;
  value: string;
  sublabel?: string;
  accent?: string; // CSS color for a left rule, ties the tile to its platform
}

export function KpiTile({ label, value, sublabel, accent }: Props) {
  return (
    <div
      className="rounded-lg border border-border bg-surface-1 px-4 py-3"
      style={accent ? { borderLeftColor: accent, borderLeftWidth: "3px" } : undefined}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold text-ink-primary tabular-nums">{value}</div>
      {sublabel && <div className="mt-0.5 text-xs text-ink-secondary tabular-nums">{sublabel}</div>}
    </div>
  );
}
