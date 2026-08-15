import { useEffect, useState } from "react";
import type { Platform, PlatformTotals, CampaignRow, TimeseriesMetric, SyncLogEntry } from "@fig/shared";
import { PLATFORM_LABELS } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchSummary, fetchTimeseries, fetchCampaigns, triggerSync } from "../lib/api";
import { PLATFORM_COLORS } from "../lib/platformColors";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { formatRelativeTime } from "../lib/relativeTime";
import { comparisonRange, COMPARISON_LABELS, type ComparisonMode } from "../lib/comparisonRange";
import { KpiTile } from "./KpiTile";
import { TimeSeriesChart, type ChartPoint } from "./TimeSeriesChart";
import { CampaignTable } from "./CampaignTable";

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

/** % change vs the comparison period; null (not undefined) when the
 * comparison itself is undefined (zero/missing prior value), which
 * KpiTile renders as "—" rather than a misleading 0%. */
function computeDelta(current: number | null | undefined, prior: number | null | undefined): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return (current - prior) / prior;
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
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [metric, setMetric] = useState<TimeseriesMetric>("spend");
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const compRange = comparisonRange(range, comparisonMode);

    Promise.all([
      fetchSummary(range.from, range.to, [platform]),
      fetchCampaigns(range.from, range.to, platform),
      compRange ? fetchSummary(compRange.from, compRange.to, [platform]) : Promise.resolve(null),
    ])
      .then(([summary, campaignsRes, compSummary]) => {
        if (cancelled) return;
        setTotals(summary.platforms[0] ?? null);
        setCampaigns(campaignsRes.campaigns);
        setComparisonTotals(compSummary?.platforms[0] ?? null);
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

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 ${loading ? "opacity-60" : ""}`}>
        <KpiTile
          label="Spend"
          value={formatCurrency(totals?.spend)}
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.spend, comparisonTotals?.spend)}
          deltaLabel="vs comparison"
        />
        <KpiTile
          label="Impressions"
          value={formatNumber(totals?.impressions, true)}
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.impressions, comparisonTotals?.impressions)}
          deltaLabel="vs comparison"
        />
        <KpiTile
          label="Clicks"
          value={formatNumber(totals?.clicks)}
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.clicks, comparisonTotals?.clicks)}
          deltaLabel="vs comparison"
        />
        <KpiTile
          label="Orders"
          value={formatNumber(totals?.conversions)}
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.conversions, comparisonTotals?.conversions)}
          deltaLabel="vs comparison"
        />
        <KpiTile
          label="Revenue"
          value={formatCurrency(totals?.revenue)}
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.revenue, comparisonTotals?.revenue)}
          deltaLabel="vs comparison"
        />
        <KpiTile
          label="ROAS"
          value={formatMultiplier(totals?.roas)}
          accent={color}
          delta={comparisonMode === "none" ? undefined : computeDelta(totals?.roas, comparisonTotals?.roas)}
          deltaLabel="vs comparison"
        />
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 ${loading ? "opacity-60" : ""}`}>
        <KpiTile label="CTR" value={formatPercent(totals?.ctr)} />
        <KpiTile label="CPC" value={formatCurrency(totals?.cpc)} />
        <KpiTile label="CPM" value={formatCurrency(totals?.cpm)} />
        <KpiTile label="ACOS" value={formatPercent(totals?.acos)} />
        <KpiTile label="CVR" value={formatPercent(totals?.cvr)} />
        <KpiTile label="CPA" value={formatCurrency(totals?.cpa)} />
        <KpiTile label="AOV" value={formatCurrency(totals?.aov)} />
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-primary">{activeMetric.label} over time</h3>
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
        <TimeSeriesChart points={points} color={color} valueFormatter={activeMetric.formatter} seriesLabel={activeMetric.label} />
      </div>

      <CampaignTable campaigns={campaigns} grossMargin={grossMargin} targetRoas={targetRoas} />
    </div>
  );
}
