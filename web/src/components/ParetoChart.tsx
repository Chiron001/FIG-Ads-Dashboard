import { useMemo } from "react";
import { Bar, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { formatPercent } from "../lib/format";

export interface ParetoItem {
  key: string;
  label: string;
  value: number;
}

interface Props {
  items: ParetoItem[];
  color: string;
  unitLabel: string; // e.g. "campaigns", "products"
  valueFormatter: (v: number) => string;
  height?: number;
}

/** Generic 80/20 concentration chart -- bar (the metric) + cumulative-%
 * line, the one well-established exception to "never dual-axis" (a Pareto
 * chart's two series are conventionally paired and instantly legible in
 * that form). Extracted from the campaign-level Pareto in PortfolioView so
 * the same chart can rank products, SKUs, or anything else with a value. */
export function ParetoChart({ items, color, unitLabel, valueFormatter, height = 240 }: Props) {
  const { rows, toEightyPercent } = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    const total = sorted.reduce((s, i) => s + i.value, 0);
    let cumulative = 0;
    const withCumulative = sorted.map((i) => {
      cumulative += i.value;
      return { ...i, cumulativePct: total > 0 ? cumulative / total : 0 };
    });
    const idx = withCumulative.findIndex((r) => r.cumulativePct >= 0.8);
    return { rows: withCumulative, toEightyPercent: idx >= 0 ? idx + 1 : withCumulative.length };
  }, [items]);

  if (rows.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-ink-muted">Nothing to show for this range.</div>;
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-ink-secondary tabular-nums">
          <span className="font-semibold text-ink-primary">{toEightyPercent}</span> of {rows.length} {unitLabel} drive 80%
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-grid)" vertical={false} />
          <XAxis dataKey="label" tick={false} axisLine={{ stroke: "var(--color-axis)" }} tickLine={false} />
          <YAxis
            yAxisId="value"
            tickFormatter={valueFormatter}
            stroke="var(--color-axis)"
            tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 1]}
            tickFormatter={(v) => formatPercent(v, 0)}
            stroke="var(--color-axis)"
            tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <ReferenceLine yAxisId="pct" y={0.8} stroke="var(--color-status-warning)" strokeDasharray="4 3" />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0]?.payload as (typeof rows)[number] | undefined;
              if (!p) return null;
              return (
                <div className="glass rounded-md px-3 py-2 text-xs">
                  <div className="max-w-[200px] truncate font-medium text-ink-primary">{p.label}</div>
                  <div className="mt-1 tabular-nums text-ink-secondary">
                    {valueFormatter(p.value)} · cumulative {formatPercent(p.cumulativePct, 0)}
                  </div>
                </div>
              );
            }}
          />
          <Bar yAxisId="value" dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="pct" type="monotone" dataKey="cumulativePct" stroke="var(--color-status-warning)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
