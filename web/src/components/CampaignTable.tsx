import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CampaignRow, Platform } from "@fig/shared";
import { computeDerivedMetrics } from "@fig/shared";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPercentagePoints,
  formatSignedPercentWithArrow,
  formatMultiplier,
} from "../lib/format";
import { normalizeStatus } from "../lib/campaignStatus";
import { computeMedians, verdictFor, type Verdict } from "../lib/verdict";
import { CONFIDENCE_TONE } from "../lib/statsFormat";
import { computeDelta } from "../lib/delta";
import type { DateRange } from "../lib/dateRanges";
import { CampaignDetailPanel } from "./CampaignDetailPanel";
import { CompareCampaignsPanel } from "./CompareCampaignsPanel";
import { DeltaBadge } from "./DeltaBadge";

// Every row here plus the client-computed columns that depend on live
// config (gross margin, target ROAS) or on the currently-visible row set
// (% of spend/revenue, verdict medians) -- see spec §2/§3, both explicitly
// scoped to "currently filtered/visible rows", which only exists client-side.
interface EnrichedRow extends CampaignRow {
  profit: number;
  breakEvenRoas: number | null;
  pctOfSpend: number | null;
  pctOfRevenue: number | null;
  spendRevDelta: number | null;
  verdict: Verdict;
  /** vs the "Compare to" period selected in the top bar -- null when no
   * comparison is active, or this campaign didn't exist/match in it. */
  spendDelta: number | null;
  roasDelta: number | null;
}

const STATUS_DOT_CLASS: Record<string, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  muted: "bg-ink-muted",
  neutral: "bg-ink-secondary",
};

function StatusBadge({ status }: { status: string | null }) {
  const { label, tone } = normalizeStatus(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-secondary">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[tone]}`} />
      {label}
    </span>
  );
}

const VERDICT_PILL_CLASS: Record<Verdict["tone"], string> = {
  good: "bg-status-good/15 text-status-good",
  warning: "bg-status-warning/15 text-status-warning",
  critical: "bg-status-critical/15 text-status-critical",
  muted: "bg-surface-2 text-ink-muted",
  neutral: "bg-surface-2 text-ink-secondary",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  // "Scale" is spec'd as bright/emphasized vs the regular tinted pill every
  // other verdict uses -- a solid fill reads as more urgent/prominent.
  const cls = verdict.emphasis
    ? "bg-status-good text-white font-semibold"
    : `${VERDICT_PILL_CLASS[verdict.tone]} font-medium`;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{verdict.tag}</span>;
}

function signClass(value: number | null): string {
  if (value == null) return "";
  if (value > 0) return "text-status-good";
  if (value < 0) return "text-status-critical";
  return "";
}

const CONFIDENCE_DOT_CLASS: Record<string, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  muted: "bg-ink-muted",
};

/** Spec §3c: "confidence pill next to ROAS" -- a small dot on the ROAS cell
 * itself rather than a separate column, so it reads as a property of the
 * ROAS number, not a disconnected fact. */
function RoasWithConfidence({ row }: { row: EnrichedRow }) {
  const confidence = row.cvrCI?.confidence;
  return (
    <span className="inline-flex items-center gap-1.5">
      {formatMultiplier(row.roas)}
      {row.roasSkewed && (
        <span title="Right-skewed ROAS — trust the median, not this average" className="text-status-warning">
          ⚠
        </span>
      )}
      {confidence && (
        <span
          title={confidence === "insufficient" ? "Not enough clicks to trust this ROAS/CVR yet" : `${confidence} confidence (n=${formatNumber(row.clicks)} clicks)`}
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${CONFIDENCE_DOT_CLASS[CONFIDENCE_TONE[confidence]]}`}
        />
      )}
    </span>
  );
}

function ReliabilityBadge({ row }: { row: EnrichedRow }) {
  if (row.reliability.label == null) return <span className="text-ink-muted">N/A</span>;
  const cls = row.reliability.label === "Stable" ? "text-status-good" : row.reliability.label === "Variable" ? "text-status-warning" : "text-status-critical";
  return (
    <span className={cls} title={`CV ${formatPercent(row.reliability.cv, 1)} on daily ROAS`}>
      {row.reliability.label}
    </span>
  );
}

type Tier = "decision" | "detailed";

interface Column {
  key: string;
  label: string;
  align: "left" | "right";
  tiers: Tier[];
  sortValue: (r: EnrichedRow) => number | string | null;
  render: (r: EnrichedRow) => ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: "campaignName",
    label: "Campaign",
    align: "left",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.campaignName ?? r.campaignId,
    render: (r) => r.campaignName ?? r.campaignId,
  },
  {
    key: "status",
    label: "Status",
    align: "left",
    tiers: ["decision", "detailed"],
    sortValue: (r) => normalizeStatus(r.status).label,
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: "verdict",
    label: "Verdict",
    align: "left",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.verdict.tag,
    render: (r) => <VerdictBadge verdict={r.verdict} />,
  },
  {
    key: "spend",
    label: "Spend",
    align: "right",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.spend,
    render: (r) => (
      <>
        {formatCurrency(r.spend)}
        <DeltaBadge value={r.spendDelta} />
      </>
    ),
  },
  {
    key: "pctOfSpend",
    label: "% Spend",
    align: "right",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.pctOfSpend,
    render: (r) => formatPercent(r.pctOfSpend, 1),
  },
  {
    key: "impressions",
    label: "Impressions",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.impressions,
    render: (r) => formatNumber(r.impressions),
  },
  { key: "clicks", label: "Clicks", align: "right", tiers: ["detailed"], sortValue: (r) => r.clicks, render: (r) => formatNumber(r.clicks) },
  { key: "ctr", label: "CTR", align: "right", tiers: ["detailed"], sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  { key: "cvr", label: "CVR", align: "right", tiers: ["detailed"], sortValue: (r) => r.cvr, render: (r) => formatPercent(r.cvr) },
  { key: "cpc", label: "CPC", align: "right", tiers: ["detailed"], sortValue: (r) => r.cpc, render: (r) => formatCurrency(r.cpc) },
  { key: "cpa", label: "CPA", align: "right", tiers: ["decision", "detailed"], sortValue: (r) => r.cpa, render: (r) => formatCurrency(r.cpa) },
  {
    key: "conversions",
    label: "Orders",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.conversions,
    render: (r) => formatNumber(r.conversions),
  },
  { key: "aov", label: "AOV", align: "right", tiers: ["decision", "detailed"], sortValue: (r) => r.aov, render: (r) => formatCurrency(r.aov) },
  {
    key: "revenue",
    label: "Revenue",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.revenue,
    render: (r) => formatCurrency(r.revenue),
  },
  {
    key: "pctOfRevenue",
    label: "% Rev",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.pctOfRevenue,
    render: (r) => formatPercent(r.pctOfRevenue, 1),
  },
  {
    key: "spendRevDelta",
    label: "Spend–Rev Δ",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.spendRevDelta,
    render: (r) => <span className={signClass(r.spendRevDelta)}>{formatPercentagePoints(r.spendRevDelta)}</span>,
  },
  {
    key: "roas",
    label: "ROAS",
    align: "right",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.roas,
    render: (r) => (
      <>
        <RoasWithConfidence row={r} />
        <DeltaBadge value={r.roasDelta} />
      </>
    ),
  },
  {
    key: "reliability",
    label: "Reliability",
    align: "right",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.reliability.cv,
    render: (r) => <ReliabilityBadge row={r} />,
  },
  {
    key: "marginalRoas",
    label: "Marginal ROAS",
    align: "right",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.marginalRoas,
    render: (r) => formatMultiplier(r.marginalRoas),
  },
  {
    key: "breakEvenRoas",
    label: "Break-even ROAS",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.breakEvenRoas,
    render: (r) => formatMultiplier(r.breakEvenRoas),
  },
  { key: "acos", label: "ACOS", align: "right", tiers: ["detailed"], sortValue: (r) => r.acos, render: (r) => formatPercent(r.acos) },
  {
    key: "profit",
    label: "Profit",
    align: "right",
    tiers: ["decision", "detailed"],
    sortValue: (r) => r.profit,
    render: (r) => <span className={signClass(r.profit)}>{formatCurrency(r.profit)}</span>,
  },
  {
    key: "searchImpressionShare",
    label: "Impr. Share",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.searchImpressionShare,
    render: (r) => formatPercent(r.searchImpressionShare, 1),
  },
  {
    key: "searchBudgetLostImpressionShare",
    label: "Lost IS (Budget)",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.searchBudgetLostImpressionShare,
    render: (r) => formatPercent(r.searchBudgetLostImpressionShare, 1),
  },
  {
    key: "roasDeltaWoW",
    label: "ROAS Δ WoW",
    align: "right",
    tiers: ["detailed"],
    sortValue: (r) => r.roasDeltaWoW,
    render: (r) => <span className={signClass(r.roasDeltaWoW)}>{formatSignedPercentWithArrow(r.roasDeltaWoW)}</span>,
  },
];

// Columns with no meaningful total/weighted-average -- rendered as "—" in
// the summary row rather than reusing per-row formatting on data that
// wouldn't mean what it looks like it means (a naive average of per-
// campaign impression shares isn't impression-weighted, so it's not the
// account's real impression share).
const NO_SUMMARY_COLUMNS = new Set([
  "status",
  "verdict",
  "searchImpressionShare",
  "searchBudgetLostImpressionShare",
  "roasDeltaWoW",
  "reliability", // CV isn't portfolio-summable/weighted-averageable in a meaningful way
  "marginalRoas", // would need a second prior-period aggregate fetch; not built for the summary row
]);

function compareValues(av: number | string | null, bv: number | string | null, dir: "asc" | "desc"): number {
  // Nulls always sort last regardless of direction (spec §5).
  const aNull = av == null;
  const bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av < bv ? -1 : av > bv ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

interface Props {
  campaigns: CampaignRow[];
  grossMargin: number;
  targetRoas: number;
  platform: Platform;
  range: DateRange;
  /** The same campaign breakdown, fetched for the "Compare to" period --
   * null when no comparison is active. Matched by campaignId below. */
  comparisonCampaigns?: CampaignRow[] | null;
}

export function CampaignTable({ campaigns, grossMargin, targetRoas, platform, range, comparisonCampaigns }: Props) {
  const [search, setSearch] = useState("");
  const [hideZeroSpend, setHideZeroSpend] = useState(true); // spec §5 default
  const [tier, setTier] = useState<Tier>("decision"); // spec §4 default
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [detailCampaignId, setDetailCampaignId] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (hideZeroSpend && c.spend === 0) return false;
      if (term && !(c.campaignName ?? c.campaignId).toLowerCase().includes(term)) return false;
      return true;
    });
  }, [campaigns, search, hideZeroSpend]);

  const breakEvenRoas = grossMargin > 0 ? 1 / grossMargin : null;

  // % of Spend / % of Revenue / verdict medians are all defined over the
  // *visible* set (spec §2/§3) -- recomputed here whenever that set changes.
  const comparisonByCampaignId = useMemo(() => {
    if (!comparisonCampaigns) return null;
    return new Map(comparisonCampaigns.map((c) => [c.campaignId, c]));
  }, [comparisonCampaigns]);

  const enriched = useMemo((): EnrichedRow[] => {
    const totalSpend = visible.reduce((s, r) => s + r.spend, 0);
    const totalRevenue = visible.reduce((s, r) => s + r.revenue, 0);
    const medians = computeMedians(visible);

    return visible.map((r) => {
      const pctOfSpend = totalSpend > 0 ? r.spend / totalSpend : null;
      const pctOfRevenue = totalRevenue > 0 ? r.revenue / totalRevenue : null;
      const comp = comparisonByCampaignId?.get(r.campaignId) ?? null;
      return {
        ...r,
        profit: r.revenue * grossMargin - r.spend,
        breakEvenRoas,
        pctOfSpend,
        pctOfRevenue,
        spendRevDelta: pctOfSpend != null && pctOfRevenue != null ? pctOfRevenue - pctOfSpend : null,
        verdict: verdictFor(r, targetRoas, breakEvenRoas ?? Infinity, medians),
        spendDelta: computeDelta(r.spend, comp?.spend),
        roasDelta: computeDelta(r.roas, comp?.roas),
      };
    });
  }, [visible, grossMargin, targetRoas, breakEvenRoas, comparisonByCampaignId]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return enriched;
    return [...enriched].sort((a, b) => compareValues(col.sortValue(a), col.sortValue(b), sortDir));
  }, [enriched, sortKey, sortDir]);

  const summaryRow = useMemo((): EnrichedRow | null => {
    if (enriched.length === 0) return null;
    const sums = enriched.reduce(
      (acc, r) => ({
        spend: acc.spend + r.spend,
        impressions: acc.impressions + r.impressions,
        clicks: acc.clicks + r.clicks,
        conversions: acc.conversions + r.conversions,
        revenue: acc.revenue + r.revenue,
      }),
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }
    );
    // Weighted, never averaged: ROAS = ΣRevenue/ΣSpend, CTR = ΣClicks/ΣImpr,
    // etc -- falls straight out of computeDerivedMetrics on the summed
    // inputs, which is exactly that ratio (spec §5).
    const derived = computeDerivedMetrics(sums);

    // Same weighted-rollup treatment for the comparison side, over
    // whichever comparison campaigns matched the currently-visible set
    // (not the full comparison-period roster -- a filtered/hidden-zero-
    // spend view should compare like against like).
    const compSums = enriched.reduce(
      (acc, r) => {
        const comp = comparisonByCampaignId?.get(r.campaignId);
        if (!comp) return acc;
        return { spend: acc.spend + comp.spend, revenue: acc.revenue + comp.revenue };
      },
      { spend: 0, revenue: 0 }
    );
    const compRoas = compSums.spend > 0 ? compSums.revenue / compSums.spend : null;

    return {
      campaignId: "__summary__",
      campaignName: "Total",
      status: null,
      ...sums,
      ...derived,
      searchImpressionShare: null,
      searchBudgetLostImpressionShare: null,
      roasDeltaWoW: null,
      reliability: { cv: null, label: null }, // not portfolio-summable -- see NO_SUMMARY_COLUMNS
      roasSkewed: false,
      cpaSkewed: false,
      cvrCI: null,
      marginalRoas: null,
      profit: sums.revenue * grossMargin - sums.spend,
      breakEvenRoas,
      pctOfSpend: sums.spend > 0 ? 1 : null,
      pctOfRevenue: sums.revenue > 0 ? 1 : null,
      spendRevDelta: sums.spend > 0 && sums.revenue > 0 ? 0 : null,
      verdict: { tag: "Review", tone: "neutral" },
      spendDelta: computeDelta(sums.spend, compSums.spend > 0 ? compSums.spend : null),
      roasDelta: computeDelta(derived.roas, compRoas),
    };
  }, [enriched, grossMargin, breakEvenRoas, comparisonByCampaignId]);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const columns = COLUMNS.filter((c) => c.tiers.includes(tier));

  return (
    <div className="rounded-2xl border border-border bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-primary">
          Campaigns <span className="font-normal text-ink-muted">({sorted.length})</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCompare(true)}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-2 transition-colors"
          >
            Compare two campaigns
          </button>
          <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <input type="checkbox" checked={hideZeroSpend} onChange={(e) => setHideZeroSpend(e.target.checked)} className="accent-platform-google" />
            Hide zero-spend
          </label>
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {(["decision", "detailed"] as Tier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`rounded px-2 py-1 capitalize transition-colors ${
                  tier === t ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
          />
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-muted">
          {campaigns.length === 0 ? "No campaigns found for this platform." : "No campaigns match the current filters."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`cursor-pointer select-none whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.label}
                    {sortKey === col.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.campaignId} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-4 py-2 tabular-nums ${
                        col.align === "right" ? "text-right text-ink-secondary" : "text-left text-ink-primary"
                      } ${col.key === "campaignName" ? "max-w-xs truncate font-medium" : ""}`}
                    >
                      {col.key === "campaignName" ? (
                        <button
                          type="button"
                          onClick={() => setDetailCampaignId(row.campaignId)}
                          className="max-w-full truncate text-left hover:underline"
                          title="View reliability, anomalies, and diagnostics"
                        >
                          {col.render(row)}
                        </button>
                      ) : (
                        col.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {summaryRow && (
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2/40 font-semibold">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-4 py-2 tabular-nums ${col.align === "right" ? "text-right text-ink-secondary" : "text-left text-ink-primary"}`}
                    >
                      {col.key === "campaignName" ? "Total" : NO_SUMMARY_COLUMNS.has(col.key) ? "N/A" : col.render(summaryRow)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {detailCampaignId &&
        (() => {
          const campaign = enriched.find((c) => c.campaignId === detailCampaignId);
          return campaign ? (
            <CampaignDetailPanel
              platform={platform}
              range={range}
              grossMargin={grossMargin}
              campaign={campaign}
              onClose={() => setDetailCampaignId(null)}
            />
          ) : null;
        })()}

      {showCompare && <CompareCampaignsPanel platform={platform} range={range} campaigns={campaigns} onClose={() => setShowCompare(false)} />}
    </div>
  );
}
