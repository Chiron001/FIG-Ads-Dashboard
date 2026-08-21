import { useMemo } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { CampaignForecastActualPoint, ForecastAdSpendRow } from "@fig/shared";
import { formatDateLabel } from "../lib/format";

interface Props {
  recentActual: CampaignForecastActualPoint[];
  forecast: ForecastAdSpendRow[];
  metric: "spend" | "revenue";
  color: string;
  valueFormatter: (v: number | null | undefined) => string;
}

interface ChartRow {
  date: string;
  actual: number | null;
  predicted: number | null;
  ciBand: [number, number] | null;
}

/** Actual history (solid line) continuing into a dashed forecast line with a
 * shaded confidence band -- the standard "forecast chart" reading, added
 * alongside (not replacing) this app's existing plain TimeSeriesChart. The
 * last actual point is duplicated as the forecast series' first point so
 * the dashed line visually starts exactly where the solid one ends, rather
 * than leaving a gap. */
export function CampaignForecastChart({ recentActual, forecast, metric, color, valueFormatter }: Props) {
  const data = useMemo((): ChartRow[] => {
    const actualRows: ChartRow[] = recentActual.map((p) => ({
      date: p.date,
      actual: metric === "spend" ? p.spend : p.revenue,
      predicted: null,
      ciBand: null,
    }));

    if (actualRows.length > 0) {
      const last = actualRows[actualRows.length - 1];
      last.predicted = last.actual;
    }

    const forecastRows: ChartRow[] = forecast
      .filter((f) => (metric === "spend" ? true : f.predictedRevenue != null))
      .map((f) => {
        const value = metric === "spend" ? f.predictedSpend : (f.predictedRevenue ?? 0);
        // ciLow/ciHigh are computed on spend specifically (see
        // forecast.ts) -- shown only for the spend metric, not scaled/
        // reused for revenue, which would misrepresent the band's meaning.
        const band: [number, number] | null = metric === "spend" && f.ciLow != null && f.ciHigh != null ? [f.ciLow, f.ciHigh] : null;
        return { date: f.forecastDate, actual: null, predicted: value, ciBand: band };
      });

    return [...actualRows, ...forecastRows];
  }, [recentActual, forecast, metric]);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
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
            const row = payload[0]?.payload as ChartRow | undefined;
            if (!row) return null;
            const isForecast = row.actual == null && row.predicted != null;
            const value = row.actual ?? row.predicted;
            return (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg shadow-black/40">
                <div className="text-ink-muted">{formatDateLabel(String(label))}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`inline-block h-0.5 w-3 ${isForecast ? "border-t-2 border-dashed" : ""}`} style={{ background: isForecast ? "transparent" : color, borderColor: color }} />
                  <span className="font-semibold text-ink-primary tabular-nums">{valueFormatter(value)}</span>
                  <span className="text-ink-secondary">{isForecast ? "predicted" : "actual"}</span>
                </div>
                {row.ciBand && (
                  <div className="mt-0.5 text-[11px] text-ink-muted">
                    Range: {valueFormatter(row.ciBand[0])} – {valueFormatter(row.ciBand[1])}
                  </div>
                )}
              </div>
            );
          }}
        />
        <Area dataKey="ciBand" stroke="none" fill={color} fillOpacity={0.12} isAnimationActive={false} />
        <Line type="monotone" dataKey="actual" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
        <Line
          type="monotone"
          dataKey="predicted"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
