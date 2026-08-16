import { useEffect, useMemo, useState } from "react";
import type { CampaignRow, AdRow, GrainPlatform } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchAds } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { normalizeStatus } from "../lib/campaignStatus";
import { computeMedians, verdictFor, type Verdict } from "../lib/verdict";

interface Props {
  platform: GrainPlatform;
  range: DateRange;
  grossMargin: number;
  targetRoas: number;
  campaigns: CampaignRow[];
  refreshKey: number;
}

interface EnrichedAdRow extends AdRow {
  profit: number;
  pctOfSpend: number | null;
  verdict: Verdict;
}

const VERDICT_PILL_CLASS: Record<Verdict["tone"], string> = {
  good: "bg-status-good/15 text-status-good",
  warning: "bg-status-warning/15 text-status-warning",
  critical: "bg-status-critical/15 text-status-critical",
  muted: "bg-surface-2 text-ink-muted",
  neutral: "bg-surface-2 text-ink-secondary",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const cls = verdict.emphasis ? "bg-status-good text-white font-semibold" : `${VERDICT_PILL_CLASS[verdict.tone]} font-medium`;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{verdict.tag}</span>;
}

function signClass(value: number): string {
  if (value > 0) return "text-status-good";
  if (value < 0) return "text-status-critical";
  return "";
}

/** ad.name is empty for several ad types (e.g. auto-generated RSAs) -- fall
 * back to id + type per spec §2b rather than showing a blank cell. */
function adLabel(row: AdRow): string {
  if (row.adName) return row.adName;
  return `${row.adType ?? "Ad"} #${row.adId}`;
}

export function AdsSection({ platform, range, grossMargin, targetRoas, campaigns, refreshKey }: Props) {
  const [campaignId, setCampaignId] = useState("");
  const [data, setData] = useState<{ ads: AdRow[]; reconciliation: import("@fig/shared").ReconciliationInfo } | null>(null);
  const [loading, setLoading] = useState(false);
  const [hideZeroSpend, setHideZeroSpend] = useState(true);

  // Switching platform (tab change) shouldn't carry over a campaign filter
  // from a different platform's ID space.
  useEffect(() => setCampaignId(""), [platform]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAds(platform, range.from, range.to, campaignId || null)
      .then((res) => !cancelled && setData(res))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [platform, range.from, range.to, campaignId, refreshKey]);

  const breakEvenRoas = grossMargin > 0 ? 1 / grossMargin : null;

  const enriched = useMemo((): EnrichedAdRow[] => {
    if (!data) return [];
    const visible = data.ads.filter((a) => !hideZeroSpend || a.spend > 0);
    const totalSpend = visible.reduce((s, a) => s + a.spend, 0);
    const medians = computeMedians(visible);
    return visible
      .map((a) => ({
        ...a,
        profit: a.revenue * grossMargin - a.spend,
        pctOfSpend: totalSpend > 0 ? a.spend / totalSpend : null,
        verdict: verdictFor(
          { spend: a.spend, conversions: a.conversions, status: a.adStatus, roas: a.roas, searchBudgetLostImpressionShare: null, ctr: a.ctr, cvr: a.cvr },
          targetRoas,
          breakEvenRoas ?? Infinity,
          medians
        ),
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [data, hideZeroSpend, grossMargin, targetRoas, breakEvenRoas]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="rounded-md border border-border bg-surface-0 px-2 py-1.5 text-xs text-ink-secondary"
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.campaignId} value={c.campaignId}>
                {c.campaignName ?? c.campaignId}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={hideZeroSpend}
              onChange={(e) => setHideZeroSpend(e.target.checked)}
              className={platform === "google" ? "accent-platform-google" : "accent-platform-meta"}
            />
            Hide zero-spend
          </label>
        </div>
      </div>

      {data && !data.reconciliation.withinTolerance && data.reconciliation.deviationPct != null && (
        <div className="mx-4 mt-3 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-ink-secondary">
          <span className="font-medium text-status-warning">⚠ Reconciliation gap:</span> this breakdown covers{" "}
          {formatCurrency(data.reconciliation.grainSpend)} of {formatCurrency(data.reconciliation.campaignSpend)} campaign spend (
          {formatPercent(data.reconciliation.deviationPct, 1)} off)
          {platform === "google" ? " -- Shopping/PMax campaigns have no ad-level rows here; see the Products section for those." : "."}
        </div>
      )}
      {data && data.reconciliation.withinTolerance && data.reconciliation.deviationPct != null && (
        <div className="mx-4 mt-2 text-xs text-ink-muted">
          Reconciles to campaign spend within tolerance ({formatPercent(data.reconciliation.deviationPct, 2)} of{" "}
          {formatCurrency(data.reconciliation.campaignSpend)}).
        </div>
      )}

      <div className={`mt-3 overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        {enriched.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">
            {data ? "No ad-level data for this range/filter yet." : "Loading…"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Ad</th>
                <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Type</th>
                <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Status</th>
                <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {platform === "google" ? "Ad Group" : "Ad Set"}
                </th>
                <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Verdict</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Spend</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">% Spend</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Impr.</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Clicks</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CTR</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CVR</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CPC</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CPA</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Orders</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Revenue</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">ROAS</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Profit</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((a) => {
                const status = normalizeStatus(a.adStatus);
                return (
                  <tr key={a.adId} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                    <td className="max-w-[220px] truncate px-4 py-2 font-medium text-ink-primary" title={adLabel(a)}>
                      {adLabel(a)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-secondary">{a.adType ?? "N/A"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-secondary">{status.label}</td>
                    <td className="max-w-[160px] truncate px-4 py-2 text-ink-secondary" title={a.adGroupName ?? a.adGroupId}>
                      {a.adGroupName ?? a.adGroupId}
                    </td>
                    <td className="px-4 py-2">
                      <VerdictBadge verdict={a.verdict} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(a.spend)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(a.pctOfSpend, 1)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(a.impressions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(a.clicks)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(a.ctr)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(a.cvr)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(a.cpc)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(a.cpa)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(a.conversions)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(a.revenue)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatMultiplier(a.roas)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${signClass(a.profit)}`}>{formatCurrency(a.profit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
