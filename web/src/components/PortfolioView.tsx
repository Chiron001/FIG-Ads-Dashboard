import { useEffect, useState } from "react";
import { Bar, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import type { Platform, PortfolioResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchPortfolio } from "../lib/api";
import { formatCurrency, formatPercent } from "../lib/format";

interface Props {
  platform: Platform;
  range: DateRange;
  grossMargin: number;
  color: string;
  refreshKey: number;
}

export function PortfolioView({ platform, range, grossMargin, color, refreshKey }: Props) {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPortfolio(platform, range.from, range.to, grossMargin)
      .then((res) => !cancelled && setData(res))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [platform, range.from, range.to, grossMargin, refreshKey]);

  if (loading && !data) {
    return <div className="rounded-lg border border-border bg-surface-1 px-4 py-8 text-center text-sm text-ink-muted">Loading portfolio…</div>;
  }
  if (!data || data.totalCampaigns === 0) {
    return <div className="rounded-lg border border-border bg-surface-1 px-4 py-8 text-center text-sm text-ink-muted">No campaign data in this range.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink-primary">Revenue concentration (Pareto)</h3>
          <span className="text-xs text-ink-secondary tabular-nums">
            <span className="font-semibold text-ink-primary">{data.campaignsToEightyPercent}</span> of {data.totalCampaigns} campaigns drive 80% of
            revenue
          </span>
        </div>
        {/* Deliberate dual-axis chart -- this is the one well-established
            exception to "never dual-axis": a Pareto chart's bar (revenue)
            + cumulative-% line are conventionally paired and instantly
            legible in that form; that's what was asked for. */}
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data.pareto} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-grid)" vertical={false} />
            <XAxis dataKey="campaignName" tick={false} axisLine={{ stroke: "var(--color-axis)" }} tickLine={false} />
            <YAxis
              yAxisId="revenue"
              tickFormatter={(v) => formatCurrency(v, true)}
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
                const p = payload[0]?.payload as (typeof data.pareto)[number] | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg shadow-black/40">
                    <div className="max-w-[200px] truncate font-medium text-ink-primary">{p.campaignName ?? p.campaignId}</div>
                    <div className="mt-1 text-ink-secondary tabular-nums">
                      {formatCurrency(p.revenue)} · cumulative {formatPercent(p.cumulativePct, 0)}
                    </div>
                  </div>
                );
              }}
            />
            <Bar yAxisId="revenue" dataKey="revenue" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="cumulativePct"
              stroke="var(--color-status-warning)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-lg border border-border bg-surface-1">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-primary">Profit contribution ranking</h3>
          <p className="mt-0.5 text-xs text-ink-muted">Ranked by absolute profit (revenue × margin − spend), not ROAS.</p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-1">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Campaign</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Contribution</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {data.contribution.map((c) => (
                <tr key={c.campaignId} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                  <td className="max-w-xs truncate px-4 py-2 font-medium text-ink-primary">{c.campaignName ?? c.campaignId}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${c.contribution > 0 ? "text-status-good" : c.contribution < 0 ? "text-status-critical" : "text-ink-secondary"}`}>
                    {formatCurrency(c.contribution)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(c.pctOfTotal, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
