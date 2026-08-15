import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatDateLabel } from "../lib/format";

export interface ChartPoint {
  date: string;
  value: number | null;
}

interface Props {
  points: ChartPoint[];
  color: string;
  valueFormatter: (v: number | null | undefined) => string;
  seriesLabel: string;
}

// Single-series line chart (one platform, one metric) — no legend needed,
// the card title above this already names the series (dataviz skill: a
// single series needs no legend box). Crosshair + one-row tooltip per
// interaction.md.
export function TimeSeriesChart({ points, color, valueFormatter, seriesLabel }: Props) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--color-grid)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          stroke="var(--color-axis)"
          tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "var(--color-axis)" }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => valueFormatter(v)}
          stroke="var(--color-axis)"
          tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-axis)", strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const value = payload[0]?.value as number | null | undefined;
            return (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg shadow-black/40">
                <div className="text-ink-muted">{formatDateLabel(String(label))}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3" style={{ background: color }} />
                  <span className="font-semibold text-ink-primary tabular-nums">{valueFormatter(value)}</span>
                  <span className="text-ink-secondary">{seriesLabel}</span>
                </div>
              </div>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
