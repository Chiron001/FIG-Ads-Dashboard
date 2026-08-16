import { useEffect, useState } from "react";
import type { Platform, PlatformTotals, CampaignRow, TimeseriesMetric, SyncLogEntry } from "@fig/shared";
import { PLATFORM_LABELS } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchSummary, fetchTimeseries, fetchCampaigns, triggerSync } from "../lib/api";
import { PLATFORM_COLORS } from "../lib/platformColors";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { formatRelativeTime } from "../lib/relativeTime";
import { comparisonRange, COMPARISON_LABELS, type ComparisonMode } from "../lib/comparisonRange";
import { computeDelta } from "../lib/delta";
import { KpiTile } from "./KpiTile";
import { TimeSeriesChart, type ChartPoint, type SmoothingMode } from "./TimeSeriesChart";
import { CampaignTable } from "./CampaignTable";
import { PortfolioView } from "./PortfolioView";
import { ProductsSection } from "./ProductsSection";
import { AdsSection } from "./AdsSection";

interface Props {
  platform: Platform;
  range: DateRange;
  connected: boolean;
  lastSync: SyncLogEntry | null;
  onSyncComplete: () => void;
  /** Bumped by the parent whenever any sync completes, to force a data refetch here. */
  refreshKey: number;
  grossMargin: number;
  targetRoas: number;
  comparisonMode: ComparisonMode;
}

/** Return on the *next rupee* of spend (spec §6c) -- always vs the
 * immediately preceding period, independent of whatever the "Compare to"
 * dropdown is set to (that's for arbitrary period comparison; this is a
 * fixed definition). Null if spend didn't increase -- marginal analysis
 * assumes added spend. */
function computeMarginalRoas(current: PlatformTotals | null, prior: PlatformTotals | null): number | null {
  if (!current || !prior) return null;
  const deltaSpend = current.spend - prior.spend;
  if (deltaSpend <= 0) return null;
  return (current.revenue - prior.revenue) / deltaSpend;
}

const METRIC_OPTIONS: { value: TimeseriesMetric; label: string; formatter: (v: number | null | undefined) => string }[] = [
  { value: "spend", label: "Spend", formatter: (v) => formatCurrency(v, true) },
  { value: "revenue", label: "Revenue", formatter: (v) => formatCurrency(v, true) },
  { value: "impressions", label: "Impressions", formatter: (v) => formatNumber(v, true) },
  { value: "clicks", label: "Clicks", formatter: (v) => formatNumber(v, true) },
  { value: "conversions", label: "Orders", formatter: (v) => formatNumber(v, true) },
  { value: "roas", label: "ROAS", formatter: (v) => formatMultiplier(v) },
  { value: "ctr", label: "CTR", formatter: (v) => formatPercent(v) },
  { value: "acos", label: "ACOS", formatter: (v) => formatPercent(v) },
];

const SMOOTHING_OPTIONS: { value: SmoothingMode; label: string }[] = [
  { value: "ma7", label: "7d MA" },
  { value: "ewma", label: "EWMA" },
  { value: "raw", label: "Raw" },
];

export function PlatformSection({
  platform,
  range,
  connected,
  lastSync,
  onSyncComplete,
  refreshKey,
  grossMargin,
  targetRoas,
  comparisonMode,
}: Props) {
  const [totals, setTotals] = useState<PlatformTotals | null>(null);
  const [comparisonTotals, setComparisonTotals] = useState<PlatformTotals | null>(null);
  const [priorPeriodTotals, setPriorPeriodTotals] = useState<PlatformTotals | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [comparisonCampaigns, setComparisonCampaigns] = useState<CampaignRow[] | null>(null);
  const [metric, setMetric] = useState<TimeseriesMetric>("spend");
  const [smoothing, setSmoothing] = useState<SmoothingMode>("ma7"); // spec §5: smoothed is the default, not raw
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [showAds, setShowAds] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const compRange = comparisonRange(range, comparisonMode);
    const priorRange = comparisonRange(range, "previous_period");

    Promise.all([
      fetchSummary(range.from, range.to, [platform]),
      fetchCampaigns(range.from, range.to, platform),
      compRange ? fetchSummary(compRange.from, compRange.to, [platform]) : Promise.resolve(null),
      priorRange ? fetchSummary(priorRange.from, priorRange.to, [platform]) : Promise.resolve(null),
      // Comparison mode isn't just the KPI row's deltas anymore -- Campaigns
      // and Portfolio analysis both want the same comparison-period rows.
      compRange ? fetchCampaigns(compRange.from, compRange.to, platform) : Promise.resolve(null),
    ])
      .then(([summary, campaignsRes, compSummary, priorSummary, compCampaignsRes]) => {
        if (cancelled) return;
        setTotals(summary.platforms[0] ?? null);
        setCampaigns(campaignsRes.campaigns);
        setComparisonTotals(compSummary?.platforms[0] ?? null);
        setPriorPeriodTotals(priorSummary?.platforms[0] ?? null);
        setComparisonCampaigns(compCampaignsRes?.campaigns ?? null);
      })
      .catch((err) => !cancelled && setError(String(err.message ?? err)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [platform, range.from, range.to, connected, refreshKey, comparisonMode]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    fetchTimeseries(range.from, range.to, [platform], metric)
      .then((res) => {
        if (cancelled) return;
        setPoints(res.points.map((p) => ({ date: p.date, value: (p[platform] as number | null) ?? null })));
      })
      .catch((err) => !cancelled && setError(String(err.message ?? err)));

    return () => {
      cancelled = true;
    };
  }, [platform, range.from, range.to, metric, connected, refreshKey]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerSync(platform, range.from, range.to);
      onSyncComplete();
    } finally {
      setSyncing(false);
    }
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-12 text-center">
        <div className="text-sm font-medium text-ink-primary">{PLATFORM_LABELS[platform]} isn't connected yet</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          {platform === "myntra"
            ? "Myntra has no public ads API — data comes in via CSV upload. That panel isn't built yet."
            : `${PLATFORM_LABELS[platform]} credentials aren't configured, or the connector is still on hold.`}
        </p>
      </div>
    );
  }

  const color = PLATFORM_COLORS[platform];
  const activeMetric = METRIC_OPTIONS.find((m) => m.value === metric)!;
  const marginalRoas = computeMarginalRoas(totals, priorPeriodTotals);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>
          {lastSync ? (
            <>
              Last synced {formatRelativeTime(lastSync.runAt)}
              {lastSync.status !== "success" && <span className="text-status-critical"> — {lastSync.status}</span>}
            </>
          ) : (
            "Never synced"
          )}
        </span>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink-secondary hover:bg-surface-2 disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
          {error}
        </div>
      )}

      {comparisonMode !== "none" && (
        <div className="text-xs text-ink-muted">
          Comparing to <span className="text-ink-secondary">{COMPARISON_LABELS[comparisonMode].toLowerCase()}</span>
          {comparisonTotals === null && !loading && " — no data for that period"}
        </div>
      )}

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7 ${loading ? "opacity-60" : ""}`}>
        <KpiTile
          label="Spend"
          value={formatCurrency(totals?.spend)}
          numeric={totals?.spend}
          numericFormat="currency"
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.spend, comparisonTotals?.spend)}
          deltaLabel="vs comparison"
          staggerIndex={0}
        />
        <KpiTile
          label="Impressions"
          value={formatNumber(totals?.impressions, true)}
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.impressions, comparisonTotals?.impressions)}
          deltaLabel="vs comparison"
          staggerIndex={1}
        />
        <KpiTile
          label="Clicks"
          value={formatNumber(totals?.clicks)}
          numeric={totals?.clicks}
          numericFormat="number"
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.clicks, comparisonTotals?.clicks)}
          deltaLabel="vs comparison"
          staggerIndex={2}
        />
        <KpiTile
          label="Orders"
          value={formatNumber(totals?.conversions)}
          numeric={totals?.conversions}
          numericFormat="number"
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.conversions, comparisonTotals?.conversions)}
          deltaLabel="vs comparison"
          staggerIndex={3}
        />
        <KpiTile
          label="Revenue"
          value={formatCurrency(totals?.revenue)}
          numeric={totals?.revenue}
          numericFormat="currency"
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.revenue, comparisonTotals?.revenue)}
          deltaLabel="vs comparison"
          staggerIndex={4}
        />
        <KpiTile
          label="ROAS"
          value={formatMultiplier(totals?.roas)}
          numeric={totals?.roas}
          numericFormat="multiplier"
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.roas, comparisonTotals?.roas)}
          deltaLabel="vs comparison"
          staggerIndex={5}
        />
        <KpiTile
          label="Marginal ROAS"
          value={formatMultiplier(marginalRoas)}
          sublabel="next ₹ of spend, vs prior period"
          accent={color}
          staggerIndex={6}
        />
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 ${loading ? "opacity-60" : ""}`}>
        <KpiTile label="CTR" value={formatPercent(totals?.ctr)} staggerIndex={7} />
        <KpiTile label="CPC" value={formatCurrency(totals?.cpc)} staggerIndex={8} />
        <KpiTile label="CPM" value={formatCurrency(totals?.cpm)} staggerIndex={9} />
        <KpiTile label="ACOS" value={formatPercent(totals?.acos)} staggerIndex={10} />
        <KpiTile label="CVR" value={formatPercent(totals?.cvr)} staggerIndex={11} />
        <KpiTile label="CPA" value={formatCurrency(totals?.cpa)} staggerIndex={12} />
        <KpiTile label="AOV" value={formatCurrency(totals?.aov)} staggerIndex={13} />
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-primary">{activeMetric.label} over time</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 text-xs">
              {SMOOTHING_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSmoothing(s.value)}
                  className={`rounded px-2 py-1 transition-colors ${
                    smoothing === s.value ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as TimeseriesMetric)}
              className="rounded-md border border-border bg-surface-0 px-2 py-1 text-xs text-ink-secondary"
            >
              {METRIC_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <TimeSeriesChart points={points} color={color} valueFormatter={activeMetric.formatter} seriesLabel={activeMetric.label} smoothing={smoothing} />
      </div>

      <div className="rounded-2xl border border-border bg-surface-1">
        <button
          type="button"
          onClick={() => setShowPortfolio((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div>
            <h3 className="text-sm font-semibold text-ink-primary">Portfolio analysis</h3>
            <p className="text-xs text-ink-muted">Revenue concentration (Pareto) and profit contribution ranking across all campaigns.</p>
          </div>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-ink-muted transition-transform ${showPortfolio ? "rotate-180" : ""}`}>
            <path d="M2 5.5L8 11.5L14 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {showPortfolio && (
          <div className="border-t border-border p-4">
            <PortfolioView
              platform={platform}
              range={range}
              grossMargin={grossMargin}
              targetRoas={targetRoas}
              color={color}
              refreshKey={refreshKey}
              comparisonMode={comparisonMode}
            />
          </div>
        )}
      </div>

      <CampaignTable
        campaigns={campaigns}
        grossMargin={grossMargin}
        targetRoas={targetRoas}
        platform={platform}
        range={range}
        comparisonCampaigns={comparisonCampaigns}
      />

      {/* Two new grains, Google + Meta (each has its own connector methods
          for both) -- each is a different breakdown of the SAME campaign
          spend above, never summed with it or with each other. See
          db/migrations/0005 and 0006. Amazon/Myntra have neither (Amazon on
          hold, Myntra CSV-only). */}
      {(platform === "google" || platform === "meta") && (
        <>
          <div className="rounded-2xl border border-border bg-surface-1">
            <button type="button" onClick={() => setShowProducts((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">Products</h3>
                <p className="text-xs text-ink-muted">
                  {platform === "google"
                    ? "Shopping/PMax spend broken down by product (category roll-up or individual SKU)."
                    : "Catalog-matched spend broken down by product."}
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-ink-muted transition-transform ${showProducts ? "rotate-180" : ""}`}>
                <path d="M2 5.5L8 11.5L14 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {showProducts && (
              <div className="border-t border-border">
                <ProductsSection
                  platform={platform}
                  range={range}
                  grossMargin={grossMargin}
                  campaigns={campaigns}
                  refreshKey={refreshKey}
                  comparisonMode={comparisonMode}
                />
              </div>
            )}
          </div>

          {/* Google only -- Meta's own ad-level breakdown lives in the
              Creative Performance page now, which groups by the creative
              itself rather than by ad set, so this generic ad-set/ad table
              was redundant there. */}
          {platform === "google" && (
            <div className="rounded-2xl border border-border bg-surface-1">
              <button type="button" onClick={() => setShowAds((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary">Ad Groups & Ads</h3>
                  <p className="text-xs text-ink-muted">Spend broken down per ad group and individual ad/creative.</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 text-ink-muted transition-transform ${showAds ? "rotate-180" : ""}`}>
                  <path d="M2 5.5L8 11.5L14 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {showAds && (
                <div className="border-t border-border">
                  <AdsSection platform={platform} range={range} grossMargin={grossMargin} targetRoas={targetRoas} campaigns={campaigns} refreshKey={refreshKey} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
