import { useState } from "react";
import { useCountUp } from "../lib/useCountUp";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { KpiExplainDrawer } from "./KpiExplainDrawer";

type NumericFormat = "currency" | "number" | "percent" | "multiplier";

const FORMATTERS: Record<NumericFormat, (v: number | null | undefined) => string> = {
  currency: formatCurrency,
  number: formatNumber,
  percent: formatPercent,
  multiplier: formatMultiplier,
};

interface Props {
  label: string;
  value: string;
  sublabel?: string;
  accent?: string; // CSS color for a left rule, ties the tile to its platform
  /** % change vs the comparison period, e.g. 0.124 = +12.4%. Undefined = no comparison active; null = comparison active but undefined (e.g. zero denominator). */
  delta?: number | null;
  deltaLabel?: string; // e.g. "vs previous period"
  /** Opt-in count-up: the raw number backing `value`, replayed through
   * `numericFormat` on every animation frame. Omitted -> `value` renders
   * static, exactly as before (fully backward compatible). */
  numeric?: number | null;
  numericFormat?: NumericFormat;
  /** Position within its KPI row -- staggers the entrance animation 40ms
   * apart per the motion spec ("KPIs stagger up (40ms apart)"). Omitted ->
   * no stagger delay, still fades in. */
  staggerIndex?: number;
}

export function KpiTile({ label, value, sublabel, accent, delta, deltaLabel, numeric, numericFormat = "number", staggerIndex }: Props) {
  const [explaining, setExplaining] = useState(false);
  const animated = useCountUp(numeric ?? undefined);
  const displayValue = numeric !== undefined && animated != null ? FORMATTERS[numericFormat](animated) : value;

  return (
    <>
      <button
        type="button"
        onClick={() => setExplaining(true)}
        title={`How is ${label} computed?`}
        className="glass group animate-fade-slide-in relative w-full overflow-hidden rounded-2xl px-4 py-3.5 text-left shadow-[var(--shadow-card)] transition-[transform,border-color] duration-[var(--duration-micro)] ease-[var(--ease-signature)] hover:-translate-y-0.5 hover:border-white/15 focus-visible:-translate-y-0.5"
        style={{
          backgroundImage: `linear-gradient(155deg, var(--card-sheen-1), var(--card-sheen-2) 45%), linear-gradient(200deg, color-mix(in oklab, ${accent ?? "var(--color-accent)"} 16%, transparent), transparent 60%)`,
          ...(accent ? { borderLeftColor: accent, borderLeftWidth: "3px" } : undefined),
          ...(staggerIndex !== undefined ? { animationDelay: `${staggerIndex * 40}ms` } : undefined),
        }}
      >
        <div className="flex items-center justify-between gap-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100"
          >
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 7.2v4M8 5.2v.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="font-hero-num mt-1.5 text-2xl font-semibold text-ink-primary tabular-nums">{displayValue}</div>
        {sublabel && <div className="mt-0.5 text-xs text-ink-secondary tabular-nums">{sublabel}</div>}
        {delta !== undefined && (
          <div className="mt-1 flex items-center gap-1 text-xs tabular-nums">
            {delta == null ? (
              <span className="text-ink-muted">N/A {deltaLabel}</span>
            ) : (
              <span className={delta > 0 ? "text-status-good" : delta < 0 ? "text-status-critical" : "text-ink-muted"}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {delta >= 0 ? "+" : ""}
                {(delta * 100).toFixed(1)}% {deltaLabel}
              </span>
            )}
          </div>
        )}
      </button>
      {explaining && <KpiExplainDrawer label={label} value={displayValue} sublabel={sublabel} onClose={() => setExplaining(false)} />}
    </>
  );
}
