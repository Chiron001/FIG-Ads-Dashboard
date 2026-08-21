import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { PredictiveAnalysisResponse, ForecastShopifyRow } from "@fig/shared";
import { ALL_CHANNEL_BUCKETS, CHANNEL_BUCKET_LABELS, PLATFORM_LABELS } from "@fig/shared";
import { fetchPredictiveAnalysis, runPredictiveAnalysisForecast, fetchGA4Status, triggerGA4Sync } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatSignedPercentWithArrow, formatDateLabel } from "../lib/format";
import { CHANNEL_BUCKET_COLORS } from "../lib/channelColors";
import { InfoNote } from "./InfoNote";
import { KpiTile } from "./KpiTile";
import { ExportMenu } from "./ExportMenu";
import type { ExportColumn } from "../lib/exportTable";

type Horizon = 7 | 14 | 30;
const HORIZON_OPTIONS: Horizon[] = [7, 14, 30];

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function ModelBadge({ isReliable, r2 }: { isReliable: boolean; r2: number | null }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isReliable ? "bg-status-good/15 text-status-good" : "bg-surface-2 text-ink-muted"
      }`}
      title={r2 != null ? `r² = ${r2.toFixed(3)}` : "not enough history for a trend fit"}
    >
      {isReliable ? "trend" : "flat baseline"}
    </span>
  );
}

/** The dashboard's ad-spend-to-sales forecast: predicted ad spend (ads
 * module) alongside predicted Shopify revenue/orders/AOV/CVR, so the
 * ad-to-sales relationship (or lack of it) is visible in one place instead
 * of two separate pages. Grounded in real history, not a blind projection --
 * see PredictiveAnalysisResponse's header comment in shared/src/index.ts for
 * the modeling contract and the real backtest that shaped it. */
export function PredictiveAnalysisSection() {
  const [data, setData] = useState<PredictiveAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [horizon, setHorizon] = useState<Horizon>(14);
  const [ga4Connected, setGa4Connected] = useState<boolean | null>(null);
  const [syncingGa4, setSyncingGa4] = useState(false);

  function load() {
    setLoading(true);
    fetchPredictiveAnalysis()
      .then(setData)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    fetchGA4Status()
      .then((s) => setGa4Connected(s.connected))
      .catch(() => setGa4Connected(false));
  }, []);

  async function handleRecompute() {
    setRecomputing(true);
    try {
      await runPredictiveAnalysisForecast();
      load();
    } finally {
      setRecomputing(false);
    }
  }

  async function handleSyncGa4() {
    setSyncingGa4(true);
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      await triggerGA4Sync(from, to);
      await handleRecompute();
    } finally {
      setSyncingGa4(false);
    }
  }

  const horizonDates = useMemo(() => {
    if (!data) return [];
    const dates = new Set<string>();
    data.adSpend.forEach((r) => dates.add(r.forecastDate));
    data.shopify.forEach((r) => dates.add(r.forecastDate));
    return [...dates].sort().slice(0, horizon);
  }, [data, horizon]);

  const spendByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const r of data.adSpend) m.set(r.forecastDate, (m.get(r.forecastDate) ?? 0) + r.predictedSpend);
    return m;
  }, [data]);

  const revenueAllByDate = useMemo(() => {
    const m = new Map<string, ForecastShopifyRow>();
    if (!data) return m;
    for (const r of data.shopify) if (r.channel === "all") m.set(r.forecastDate, r);
    return m;
  }, [data]);

  // Indexed to 100 at the first day of the horizon -- one shared axis ("%
  // of day 1"), so spend and revenue (wildly different absolute scales)
  // read on the SAME chart honestly, per the dataviz skill's "never
  // dual-axis" rule. This is what makes a spend line climbing while the
  // revenue line stays flat visually obvious, not just a number in a table.
  const chartData = useMemo(() => {
    if (horizonDates.length === 0) return [];
    const firstSpend = spendByDate.get(horizonDates[0]) ?? null;
    const firstRevenue = revenueAllByDate.get(horizonDates[0])?.predictedRevenue ?? null;
    return horizonDates.map((date) => {
      const spend = spendByDate.get(date) ?? null;
      const revenue = revenueAllByDate.get(date)?.predictedRevenue ?? null;
      return {
        date,
        spendIndex: spend != null && firstSpend ? (spend / firstSpend) * 100 : null,
        revenueIndex: revenue != null && firstRevenue ? (revenue / firstRevenue) * 100 : null,
      };
    });
  }, [horizonDates, spendByDate, revenueAllByDate]);

  const totals = useMemo(() => {
    const spend = horizonDates.reduce((s, d) => s + (spendByDate.get(d) ?? 0), 0);
    const revenue = horizonDates.reduce((s, d) => s + (revenueAllByDate.get(d)?.predictedRevenue ?? 0), 0);
    const orders = horizonDates.reduce((s, d) => s + (revenueAllByDate.get(d)?.predictedOrders ?? 0), 0);
    return { spend, revenue, orders, roas: safeDivide(revenue, spend) };
  }, [horizonDates, spendByDate, revenueAllByDate]);

  const channelBreakdown = useMemo(() => {
    if (!data) return [];
    return ALL_CHANNEL_BUCKETS.map((bucket) => {
      const rows = data.shopify.filter((r) => r.channel === bucket && horizonDates.includes(r.forecastDate));
      const revenue = rows.reduce((s, r) => s + r.predictedRevenue, 0);
      const orders = rows.reduce((s, r) => s + r.predictedOrders, 0);
      const lastRow = rows[rows.length - 1];
      return {
        bucket,
        revenue,
        orders,
        aov: safeDivide(revenue, orders),
        isReliable: lastRow?.isReliable ?? false,
        r2: lastRow?.r2 ?? null,
      };
    }).filter((r) => r.revenue > 0 || r.orders > 0);
  }, [data, horizonDates]);

  const dailyExportColumns: ExportColumn<{ date: string; spend: number | null; revenue: number | null; orders: number | null; aov: number | null; cvr: number | null }>[] = [
    { header: "Date", accessor: (r) => r.date },
    { header: "Predicted Ad Spend", accessor: (r) => r.spend },
    { header: "Predicted Revenue", accessor: (r) => r.revenue },
    { header: "Predicted Orders", accessor: (r) => r.orders },
    { header: "Predicted AOV", accessor: (r) => r.aov },
    { header: "Predicted CVR (%)", accessor: (r) => (r.cvr != null ? Number((r.cvr * 100).toFixed(2)) : null) },
  ];
  const dailyRows = horizonDates.map((date) => {
    const shopifyRow = revenueAllByDate.get(date);
    return {
      date,
      spend: spendByDate.get(date) ?? null,
      revenue: shopifyRow?.predictedRevenue ?? null,
      orders: shopifyRow?.predictedOrders ?? null,
      aov: shopifyRow?.predictedAov ?? null,
      cvr: shopifyRow?.predictedConversionRate ?? null,
    };
  });

  const platformsInSpend = [...new Set(data?.adSpend.map((r) => r.platform) ?? [])];
  const spendReliable = data?.adSpend.find((r) => horizonDates.includes(r.forecastDate))?.isReliable ?? false;
  const revenueReliable = revenueAllByDate.get(horizonDates[horizonDates.length - 1] ?? "")?.isReliable ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <InfoNote label="How this forecast works">
          Baseline is a 7-day moving average (a flat forecast) for every series, upgraded to a linear-regression trend
          line only when the fit's r² is at least 0.3 -- the same reliability floor the ads diminishing-returns model
          uses. Confirmed against real order history before this was built: a naive trend line lost badly to the flat
          baseline on a backtest, so this never silently assumes a clean upward line just because spend does. Channel
          breakdowns use GA4's tracked revenue (the only source with per-channel data); the "All channels" total uses
          Shopify's own ground-truth order data, which is why the two can differ -- see the reconciliation figure
          below.
        </InfoNote>
        Predictive Analysis -- ad spend and Shopify revenue/orders forecast, same timeline
      </div>

      {ga4Connected === false && (
        <div className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-ink-secondary">
          GA4 isn't connected -- channel-level forecasts won't be available until it is (Settings page).
        </div>
      )}

      {data?.funnelLag && (
        <div
          className={`rounded-2xl border p-4 ${
            data.funnelLag.flagged ? "border-status-warning/30 bg-status-warning/10" : "border-border bg-surface-1"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-medium ${data.funnelLag.flagged ? "text-status-warning" : "text-ink-primary"}`}>
              {data.funnelLag.flagged ? "Spend is forecast to outgrow revenue" : "Spend and revenue growth are broadly in line"}
            </span>
            {data.funnelLag.spendGrowthPct != null && (
              <span className="text-xs text-ink-secondary">
                Spend {formatSignedPercentWithArrow(data.funnelLag.spendGrowthPct)} over the horizon
              </span>
            )}
            {data.funnelLag.revenueGrowthPct != null && (
              <span className="text-xs text-ink-secondary">
                vs. Revenue {formatSignedPercentWithArrow(data.funnelLag.revenueGrowthPct)}
                {!revenueReliable && " (flat baseline -- no reliable upward or downward trend detected)"}
              </span>
            )}
          </div>
          {data.funnelLag.flagged && (
            <p className="mt-1.5 text-xs text-ink-secondary">
              This is the checkout-funnel signal showing up in the numbers: ad spend has a real, reliable upward trend
              while revenue doesn't -- worth checking funnel drop-off before scaling spend further on this trajectory.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {HORIZON_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              className={`rounded px-3 py-1.5 transition-colors ${
                horizon === h ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {h}-day
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncGa4}
            disabled={syncingGa4}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {syncingGa4 ? "Syncing GA4…" : "Sync GA4"}
          </button>
          <button
            type="button"
            onClick={handleRecompute}
            disabled={recomputing}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface-0 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {recomputing ? "Recomputing…" : "Recompute forecast"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label={`${horizon}-day predicted spend`} value={formatCurrency(totals.spend)} numeric={totals.spend} numericFormat="currency" />
        <KpiTile label={`${horizon}-day predicted revenue`} value={formatCurrency(totals.revenue)} numeric={totals.revenue} numericFormat="currency" />
        <KpiTile label="Predicted orders" value={formatNumber(Math.round(totals.orders))} numeric={Math.round(totals.orders)} numericFormat="number" />
        <KpiTile label="Implied ROAS" value={totals.roas != null ? `${totals.roas.toFixed(2)}x` : "N/A"} sublabel="revenue / spend, both predicted" />
      </div>

      {/* --- Combined chart: indexed to 100 at day 1 of the horizon, one
          shared axis -- a spend line climbing while revenue stays flat is
          visible directly, not something the reader has to infer from two
          separately-scaled panels. */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="font-display text-base text-ink-primary">Spend vs. Revenue Forecast, indexed</h3>
            <InfoNote label="Why indexed, not raw ₹">
              Spend (thousands) and revenue (lakhs) are on very different scales -- overlaying them as raw numbers on
              two y-axes would be misleading (a dual-axis chart can make any two lines look correlated by just
              rescaling one of them). Indexing both to 100 at day 1 of the selected horizon puts them on one honest,
              shared axis: "% of day 1", so the actual growth rates are what's being compared, nothing else.
            </InfoNote>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ background: "var(--color-accent)" }} />
              Ad Spend {!spendReliable && "(flat)"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ background: "#1baf7a" }} />
              Revenue {!revenueReliable && "(flat)"}
            </span>
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink-muted">{loading ? "Loading…" : "No forecast yet -- click Recompute forecast."}</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
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
                tickFormatter={(v) => `${v}%`}
                stroke="var(--color-axis)"
                tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-axis)", strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const spendIdx = payload.find((p) => p.dataKey === "spendIndex")?.value as number | undefined;
                  const revIdx = payload.find((p) => p.dataKey === "revenueIndex")?.value as number | undefined;
                  return (
                    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg shadow-black/40">
                      <div className="text-ink-muted">{formatDateLabel(String(label))}</div>
                      {spendIdx != null && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-3" style={{ background: "var(--color-accent)" }} />
                          <span className="font-semibold text-ink-primary tabular-nums">{spendIdx.toFixed(0)}%</span>
                          <span className="text-ink-secondary">Ad Spend</span>
                        </div>
                      )}
                      {revIdx != null && (
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-3" style={{ background: "#1baf7a" }} />
                          <span className="font-semibold text-ink-primary tabular-nums">{revIdx.toFixed(0)}%</span>
                          <span className="text-ink-secondary">Revenue</span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="spendIndex" stroke="var(--color-accent)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="revenueIndex" stroke="#1baf7a" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* --- Context: reconciliation + new-vs-returning ------------------ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data?.reconciliation && (
          <div className="rounded-2xl border border-border bg-surface-1 p-4">
            <div className="flex items-center gap-1.5">
              <h3 className="font-display text-sm text-ink-primary">GA4 vs. Shopify revenue</h3>
              <InfoNote tone={data.reconciliation.deviationPct != null && data.reconciliation.deviationPct > 0.15 ? "warning" : undefined} label="Why these differ">
                GA4 and Shopify track revenue through two different systems (browser-side event tracking vs. server-side
                order records) -- they never match exactly, and a large gap usually means real tracking loss (ad
                blockers, cross-device checkout, consent banners), not a bug. Shown so the channel-segmented forecast
                above is read with the right amount of trust.
              </InfoNote>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-ink-muted">Shopify (ground truth)</div>
                <div className="font-hero-num tabular-nums text-ink-primary">{formatCurrency(data.reconciliation.shopifyRevenue)}</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">GA4 tracked</div>
                <div className="font-hero-num tabular-nums text-ink-secondary">{formatCurrency(data.reconciliation.ga4Revenue)}</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Gap</div>
                <div className={`font-hero-num tabular-nums ${(data.reconciliation.deviationPct ?? 0) > 0.15 ? "text-status-warning" : "text-ink-secondary"}`}>
                  {formatPercent(data.reconciliation.deviationPct, 1)}
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {formatDateLabel(data.reconciliation.from)} – {formatDateLabel(data.reconciliation.to)}
            </p>
          </div>
        )}

        {data?.newVsReturning && (
          <div className="rounded-2xl border border-border bg-surface-1 p-4">
            <div className="flex items-center gap-1.5">
              <h3 className="font-display text-sm text-ink-primary">New vs. returning customers</h3>
              <InfoNote label="What this counts">
                "New" = this was the first order Claude has seen from this customer since Shopify sync history began
                ({formatDateLabel(data.newVsReturning.from)}) -- not necessarily their lifetime-first order if they
                bought before that date. Historical only, not itself forecast forward -- too little repeat-purchase
                history yet to project reliably.
              </InfoNote>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-ink-muted">New customers</div>
                <div className="font-hero-num tabular-nums text-ink-primary">{formatNumber(data.newVsReturning.newCustomerOrders)}</div>
                <div className="text-[11px] text-ink-muted">{formatCurrency(data.newVsReturning.newCustomerRevenue)}</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Returning</div>
                <div className="font-hero-num tabular-nums text-ink-primary">{formatNumber(data.newVsReturning.returningCustomerOrders)}</div>
                <div className="text-[11px] text-ink-muted">{formatCurrency(data.newVsReturning.returningCustomerRevenue)}</div>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {formatPercent(
                safeDivide(data.newVsReturning.returningCustomerOrders, data.newVsReturning.newCustomerOrders + data.newVsReturning.returningCustomerOrders),
                1
              )}{" "}
              repeat-purchase rate observed
            </p>
          </div>
        )}
      </div>

      {/* --- Channel breakdown table -------------------------------------- */}
      {channelBreakdown.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <h3 className="font-display text-sm text-ink-primary">Revenue by channel, {horizon}-day forecast</h3>
          <div className="mt-2 table-scroll-pane">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Channel</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Revenue</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Orders</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">AOV</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Model</th>
                </tr>
              </thead>
              <tbody>
                {channelBreakdown.map((c) => (
                  <tr key={c.bucket} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-left font-medium text-ink-primary">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: CHANNEL_BUCKET_COLORS[c.bucket] }} />
                      {CHANNEL_BUCKET_LABELS[c.bucket]}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(c.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(Math.round(c.orders))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(c.aov)}</td>
                    <td className="px-3 py-2 text-right">
                      <ModelBadge isReliable={c.isReliable} r2={c.r2} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Daily forecast table ------------------------------------------ */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm text-ink-primary">
            Daily forecast{platformsInSpend.length > 0 && ` -- spend across ${platformsInSpend.map((p) => PLATFORM_LABELS[p]).join(" + ")}`}
          </h3>
          <ExportMenu filename={`predictive-analysis-${horizon}d`} title="Predictive Analysis" columns={dailyExportColumns} rows={dailyRows} />
        </div>
        <div className="table-scroll-pane">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky-thead bg-surface-1 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Date</th>
                <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Ad Spend</th>
                <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Revenue</th>
                <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Orders</th>
                <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">AOV</th>
                <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CVR</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.map((r) => (
                <tr key={r.date} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-left text-ink-primary">{formatDateLabel(r.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.spend)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(r.orders != null ? Math.round(r.orders) : null)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.aov)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.cvr)}</td>
                </tr>
              ))}
              {dailyRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">
                    {loading ? "Loading…" : "No forecast yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
