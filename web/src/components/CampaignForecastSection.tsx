import { useEffect, useMemo, useState } from "react";
import type { Platform, CampaignForecastResponse, CampaignForecastGroup } from "@fig/shared";
import { fetchCampaignForecast, runPredictiveAnalysisForecast } from "../lib/api";
import { formatCurrency, formatNumber, formatMultiplier } from "../lib/format";
import { PLATFORM_COLORS } from "../lib/platformColors";
import { InfoNote } from "./InfoNote";
import { KpiTile } from "./KpiTile";
import { CampaignForecastChart } from "./CampaignForecastChart";

type Horizon = 7 | 14 | 30;
const HORIZON_OPTIONS: Horizon[] = [7, 14, 30];

interface Props {
  platform: Extract<Platform, "google" | "meta">;
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function ModelBadge({ isReliable, r2 }: { isReliable: boolean; r2: number | null }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isReliable ? "bg-status-good/15 text-status-good" : "bg-surface-2 text-ink-muted"}`}
      title={r2 != null ? `r² = ${r2.toFixed(3)}` : "not enough history for a trend fit"}
    >
      {isReliable ? "trend" : "flat baseline"}
    </span>
  );
}

/** Per-campaign ad spend/revenue/ROAS/conversions forecast for one platform
 * -- reuses the same forecast_ad_spend table and "Recompute forecast"
 * action as the Shopify Predictive Analysis page, just read at campaign
 * grain instead of platform-total grain. Validated against real campaign
 * data before being built: per-campaign r² is usually far weaker than the
 * platform-level aggregate (several real campaigns run on an intermittent
 * schedule a flat/linear model can't represent day-by-day), so horizon
 * TOTALS are the headline numbers here, not individual daily points --
 * daily noise partially cancels out in a sum. */
export function CampaignForecastSection({ platform }: Props) {
  const [data, setData] = useState<CampaignForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [horizon, setHorizon] = useState<Horizon>(14);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<"spend" | "revenue">("spend");

  function load() {
    setLoading(true);
    fetchCampaignForecast(platform)
      .then(setData)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    setSelectedCampaignId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  async function handleRecompute() {
    setRecomputing(true);
    try {
      await runPredictiveAnalysisForecast();
      load();
    } finally {
      setRecomputing(false);
    }
  }

  const horizonTotalsFor = (c: CampaignForecastGroup) => c.horizonTotals.find((h) => h.horizonDays === horizon);

  const platformTotals = useMemo(() => {
    if (!data) return { spend: 0, revenue: null as number | null, conversions: null as number | null };
    let spend = 0;
    let revenue = 0;
    let hasRevenue = false;
    let conversions = 0;
    let hasConversions = false;
    for (const c of data.campaigns) {
      const t = horizonTotalsFor(c);
      if (!t) continue;
      spend += t.totalSpend;
      if (t.totalRevenue != null) {
        revenue += t.totalRevenue;
        hasRevenue = true;
      }
      if (t.totalConversions != null) {
        conversions += t.totalConversions;
        hasConversions = true;
      }
    }
    return { spend, revenue: hasRevenue ? revenue : null, conversions: hasConversions ? conversions : null };
  }, [data, horizon]);

  const sortedCampaigns = useMemo(() => {
    if (!data) return [];
    return [...data.campaigns].sort((a, b) => (horizonTotalsFor(b)?.totalSpend ?? 0) - (horizonTotalsFor(a)?.totalSpend ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, horizon]);

  const selectedCampaign = data?.campaigns.find((c) => c.campaignId === selectedCampaignId) ?? sortedCampaigns[0] ?? null;
  const color = PLATFORM_COLORS[platform];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <InfoNote label="How this forecast works">
          Same model as the Shopify Predictive Analysis page: a 7-day moving-average baseline, upgraded to a
          linear-regression trend only when r² ≥ 0.3. Validated against real campaign history before being built --
          per-campaign accuracy is meaningfully weaker than the platform-level total (several campaigns run on an
          intermittent schedule day-to-day that a flat/linear model can't capture), so the {horizon}-day{" "}
          <strong className="text-ink-primary">totals</strong> below are the trustworthy numbers -- individual daily
          points are shown in the chart for context, not as precise predictions. Campaigns with under{" "}
          {data?.minCampaignHistoryDays ?? 7} days of history are omitted entirely, not shown with a guess.
        </InfoNote>
        Predictive Analysis -- per-campaign spend, revenue, ROAS, and conversions forecast
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {HORIZON_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              className={`rounded px-3 py-1.5 transition-colors ${horizon === h ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"}`}
            >
              {h}-day
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleRecompute}
          disabled={recomputing}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface-0 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {recomputing ? "Recomputing…" : "Recompute forecast"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label={`${horizon}-day predicted spend`} value={formatCurrency(platformTotals.spend)} numeric={platformTotals.spend} numericFormat="currency" accent={color} />
        <KpiTile
          label={`${horizon}-day predicted revenue`}
          value={platformTotals.revenue != null ? formatCurrency(platformTotals.revenue) : "N/A"}
          numeric={platformTotals.revenue}
          numericFormat="currency"
          accent={color}
        />
        <KpiTile
          label="Implied ROAS"
          value={platformTotals.revenue != null ? formatMultiplier(safeDivide(platformTotals.revenue, platformTotals.spend)) : "N/A"}
          sublabel="revenue / spend, both predicted"
          accent={color}
        />
        <KpiTile
          label="Predicted conversions"
          value={platformTotals.conversions != null ? formatNumber(Math.round(platformTotals.conversions)) : "N/A"}
          numeric={platformTotals.conversions != null ? Math.round(platformTotals.conversions) : null}
          numericFormat="number"
          accent={color}
        />
      </div>

      {data && data.skippedCampaigns.length > 0 && (
        <p className="text-xs text-ink-muted">
          {data.skippedCampaigns.length} campaign{data.skippedCampaigns.length === 1 ? "" : "s"} omitted -- under{" "}
          {data.minCampaignHistoryDays} days of history ({data.skippedCampaigns.map((c) => c.campaignName ?? c.campaignId).join(", ")}).
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Campaign table -- left/main column */}
        <div className="rounded-2xl border border-border bg-surface-1 lg:col-span-3">
          <div className="table-scroll-pane">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky-thead bg-surface-1 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Campaign</th>
                  <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Spend</th>
                  <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Revenue</th>
                  <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">ROAS</th>
                  <th className="sticky-thead bg-surface-1 px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Model</th>
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((c) => {
                  const t = horizonTotalsFor(c);
                  const isSelected = selectedCampaign?.campaignId === c.campaignId;
                  const lastForecast = c.forecast[c.forecast.length - 1];
                  return (
                    <tr
                      key={c.campaignId}
                      onClick={() => setSelectedCampaignId(c.campaignId)}
                      className={`cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent-soft ${isSelected ? "bg-accent-soft" : ""}`}
                    >
                      <td className="max-w-[220px] truncate px-3 py-2 text-left font-medium text-ink-primary" title={c.campaignName ?? c.campaignId}>
                        {c.campaignName ?? c.campaignId}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(t?.totalSpend ?? null)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(t?.totalRevenue ?? null)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{t?.roas != null ? formatMultiplier(t.roas) : "N/A"}</td>
                      <td className="px-3 py-2 text-right">{lastForecast && <ModelBadge isReliable={lastForecast.isReliable} r2={lastForecast.r2} />}</td>
                    </tr>
                  );
                })}
                {sortedCampaigns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-ink-muted">
                      {loading ? "Loading…" : "No campaigns with enough history to forecast yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected campaign detail -- chart + accuracy */}
        <div className="space-y-4 lg:col-span-2">
          {selectedCampaign ? (
            <>
              <div className="rounded-2xl border border-border bg-surface-1 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="min-w-0 truncate font-display text-sm text-ink-primary" title={selectedCampaign.campaignName ?? selectedCampaign.campaignId}>
                    {selectedCampaign.campaignName ?? selectedCampaign.campaignId}
                  </h3>
                  <div className="flex shrink-0 rounded-md border border-border p-0.5 text-[11px]">
                    {(["spend", "revenue"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setChartMetric(m)}
                        className={`rounded px-2 py-1 capitalize transition-colors ${chartMetric === m ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-2 flex items-center gap-3 text-[11px] text-ink-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-3" style={{ background: color }} />
                    Actual
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-3 border-t-2 border-dashed" style={{ borderColor: color }} />
                    Predicted
                  </span>
                </div>
                <CampaignForecastChart
                  recentActual={selectedCampaign.recentActual}
                  forecast={selectedCampaign.forecast}
                  metric={chartMetric}
                  color={color}
                  valueFormatter={(v) => formatCurrency(v)}
                />
              </div>

              <div className="rounded-2xl border border-border bg-surface-1 p-4">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-display text-sm text-ink-primary">Predicted vs. Actual</h3>
                  <InfoNote label="How this builds up">
                    Once a forecast date passes, that prediction is kept (not overwritten by the next recompute) so it
                    can be compared to what actually happened. Needs at least 3 days of forecast history to show
                    anything meaningful -- this accumulates day by day as the forecast keeps running.
                  </InfoNote>
                </div>
                {selectedCampaign.accuracy ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-ink-muted">Spend MAPE</div>
                      <div className="font-hero-num tabular-nums text-ink-primary">
                        {selectedCampaign.accuracy.spendMapePct != null ? `${selectedCampaign.accuracy.spendMapePct.toFixed(1)}%` : "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-muted">Revenue MAPE</div>
                      <div className="font-hero-num tabular-nums text-ink-primary">
                        {selectedCampaign.accuracy.revenueMapePct != null ? `${selectedCampaign.accuracy.revenueMapePct.toFixed(1)}%` : "N/A"}
                      </div>
                    </div>
                    <p className="col-span-2 text-[11px] text-ink-muted">Based on {selectedCampaign.accuracy.daysCompared} day(s) of forecast history.</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-ink-muted">Not enough forecast history yet -- check back in a few days.</p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-border bg-surface-1 p-10 text-center text-sm text-ink-muted">Select a campaign to see its forecast chart.</div>
          )}
        </div>
      </div>
    </div>
  );
}
