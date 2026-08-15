import { useEffect, useMemo, useState } from "react";
import type { MetaSkuAttributionResponse, MetaSkuAdRow, MetaSkuAdSetGroup, MetaSkuCampaignGroup, MetaSkuGroupRow } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchMetaSkuAttribution } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { normalizeStatus } from "../lib/campaignStatus";

interface Props {
  range: DateRange;
  refreshKey: number;
}

type Level = "campaign" | "adSet" | "ad" | "sku";

// Flat row shapes per level -- each carries its parent names so the Ad Set
// and Ad views can show "which campaign/ad set is this" without nesting.
interface CampaignRow extends MetaSkuCampaignGroup {
  key: string;
}
interface AdSetRow extends MetaSkuAdSetGroup {
  key: string;
  campaignId: string;
  campaignName: string | null;
}
interface AdRowFlat extends MetaSkuAdRow {
  key: string;
  campaignId: string;
  campaignName: string | null;
  adSetId: string;
  adSetName: string | null;
}
interface SkuGroupRowFlat extends MetaSkuGroupRow {
  key: string;
}

type AnyRow = CampaignRow | AdSetRow | AdRowFlat | SkuGroupRowFlat;

function SkuBadge({ sku }: { sku: string | null }) {
  if (!sku) return <span className="text-xs italic text-ink-muted">no SKU tag</span>;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">{sku}</span>;
}

function RoasCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-muted">—</span>;
  // Directional-attribution numbers can get extreme (see the caveat banner)
  // -- flag anything implausibly large rather than let it read as a real ratio.
  const extreme = value > 100;
  return <span className={extreme ? "text-status-warning" : undefined}>{formatMultiplier(value)}</span>;
}

interface Column {
  key: string;
  label: string;
  align: "left" | "right";
  levels: Level[]; // which level(s) this column applies to
  sortValue: (r: AnyRow) => number | string | null;
  render: (r: AnyRow) => React.ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: "campaignName",
    label: "Campaign",
    align: "left",
    levels: ["campaign", "adSet", "ad"],
    // All three (CampaignRow/AdSetRow/AdRowFlat) carry campaignName+campaignId
    // as real own properties -- only SkuGroupRowFlat doesn't, and this column
    // is never shown at the "sku" level anyway (see `levels` above).
    sortValue: (r) => ("campaignName" in r ? (r.campaignName ?? r.campaignId) : null),
    render: (r) => ("campaignName" in r ? (r.campaignName ?? r.campaignId) : "—"),
  },
  {
    key: "adSetName",
    label: "Ad Set",
    align: "left",
    levels: ["adSet", "ad"],
    sortValue: (r) => ("adSetName" in r ? ((r as AdSetRow).adSetName ?? (r as AdSetRow).adSetId) : null),
    render: (r) => ("adSetName" in r ? ((r as AdSetRow).adSetName ?? (r as AdSetRow).adSetId) : "—"),
  },
  {
    key: "adName",
    label: "Ad",
    align: "left",
    levels: ["ad"],
    sortValue: (r) => ("adName" in r ? ((r as AdRowFlat).adName ?? (r as AdRowFlat).adId) : null),
    render: (r) => ("adName" in r ? ((r as AdRowFlat).adName ?? (r as AdRowFlat).adId) : "—"),
  },
  {
    key: "adStatus",
    label: "Status",
    align: "left",
    levels: ["ad"],
    sortValue: (r) => ("adStatus" in r ? normalizeStatus((r as AdRowFlat).adStatus).label : null),
    render: (r) => ("adStatus" in r ? normalizeStatus((r as AdRowFlat).adStatus).label : "—"),
  },
  {
    key: "sku",
    label: "SKU",
    align: "left",
    levels: ["ad", "sku"],
    sortValue: (r) => ("sku" in r ? (r as AdRowFlat | SkuGroupRowFlat).sku : null),
    render: (r) => <SkuBadge sku={"sku" in r ? (r as AdRowFlat | SkuGroupRowFlat).sku : null} />,
  },
  {
    key: "adCount",
    label: "Ads",
    align: "right",
    levels: ["sku"],
    sortValue: (r) => ("adCount" in r ? r.adCount : null),
    render: (r) => ("adCount" in r ? formatNumber(r.adCount) : "—"),
  },
  {
    key: "campaignCount",
    label: "Campaigns",
    align: "right",
    levels: ["sku"],
    sortValue: (r) => ("campaignCount" in r ? r.campaignCount : null),
    render: (r) => ("campaignCount" in r ? formatNumber(r.campaignCount) : "—"),
  },
  {
    key: "spend",
    label: "Spend",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.spend,
    render: (r) => formatCurrency(r.spend),
  },
  {
    key: "impressions",
    label: "Impr.",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.impressions,
    render: (r) => formatNumber(r.impressions),
  },
  {
    key: "clicks",
    label: "Clicks",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.clicks,
    render: (r) => formatNumber(r.clicks),
  },
  { key: "ctr", label: "CTR", align: "right", levels: ["campaign", "adSet", "ad", "sku"], sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  { key: "cvr", label: "CVR", align: "right", levels: ["campaign", "adSet", "ad", "sku"], sortValue: (r) => r.cvr, render: (r) => formatPercent(r.cvr) },
  { key: "cpc", label: "CPC", align: "right", levels: ["campaign", "adSet", "ad", "sku"], sortValue: (r) => r.cpc, render: (r) => formatCurrency(r.cpc) },
  { key: "cpa", label: "CPA", align: "right", levels: ["campaign", "adSet", "ad", "sku"], sortValue: (r) => r.cpa, render: (r) => formatCurrency(r.cpa) },
  {
    key: "conversions",
    label: "Orders",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.conversions,
    render: (r) => formatNumber(r.conversions),
  },
  {
    key: "adsRevenue",
    label: "Ads Revenue",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.adsRevenue,
    render: (r) => formatCurrency(r.adsRevenue),
  },
  {
    key: "adsRoas",
    label: "Ads ROAS",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.adsRoas,
    render: (r) => <RoasCell value={r.adsRoas} />,
  },
  {
    key: "websiteRevenue",
    label: "Website Revenue",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.websiteRevenue,
    render: (r) => formatCurrency(r.websiteRevenue),
  },
  {
    key: "websiteRoas",
    label: "Website ROAS",
    align: "right",
    levels: ["campaign", "adSet", "ad", "sku"],
    sortValue: (r) => r.websiteRoas,
    render: (r) => <RoasCell value={r.websiteRoas} />,
  },
];

const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "adSet", label: "Ad Set" },
  { value: "ad", label: "Ad" },
  { value: "sku", label: "SKU (true ROAS)" },
];

function compareValues(av: number | string | null, bv: number | string | null, dir: "asc" | "desc"): number {
  const aNull = av == null;
  const bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls always sort last
  if (bNull) return -1;
  const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av < bv ? -1 : av > bv ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

export function MetaSkuAttributionSection({ range, refreshKey }: Props) {
  const [data, setData] = useState<MetaSkuAttributionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<Level>("campaign");
  const [onlyMatched, setOnlyMatched] = useState(false);
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMetaSkuAttribution(range.from, range.to)
      .then((res) => !cancelled && setData(res))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshKey]);

  // Switching level resets sort to that level's default column (campaign/ad
  // set name columns don't exist at every level).
  useEffect(() => {
    setSortKey("spend");
    setSortDir("desc");
  }, [level]);

  const rows = useMemo((): AnyRow[] => {
    if (!data) return [];
    if (level === "campaign") {
      const campaignRows: CampaignRow[] = data.campaigns.map((c) => ({ ...c, key: c.campaignId }));
      return onlyMatched ? campaignRows.filter((c) => c.websiteRevenue != null) : campaignRows;
    }
    if (level === "adSet") {
      const adSetRows: AdSetRow[] = data.campaigns.flatMap((c) =>
        c.adSets.map((s) => ({ ...s, key: `${c.campaignId}|${s.adSetId}`, campaignId: c.campaignId, campaignName: c.campaignName }))
      );
      return onlyMatched ? adSetRows.filter((s) => s.websiteRevenue != null) : adSetRows;
    }
    if (level === "ad") {
      const adRows: AdRowFlat[] = data.campaigns.flatMap((c) =>
        c.adSets.flatMap((s) =>
          s.ads.map((a) => ({
            ...a,
            key: a.adId,
            campaignId: c.campaignId,
            campaignName: c.campaignName,
            adSetId: s.adSetId,
            adSetName: s.adSetName,
          }))
        )
      );
      return onlyMatched ? adRows.filter((a) => a.sku != null) : adRows;
    }
    // "sku" level -- every row already has a SKU by construction (grouped
    // server-side from only the tagged ads), so onlyMatched is a no-op here.
    const skuRows: SkuGroupRowFlat[] = data.skuGroups.map((g) => ({ ...g, key: g.sku }));
    return skuRows;
  }, [data, level, onlyMatched]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey && c.levels.includes(level));
    if (!col) return rows;
    return [...rows].sort((a, b) => compareValues(col.sortValue(a), col.sortValue(b), sortDir));
  }, [rows, sortKey, sortDir, level]);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const columns = COLUMNS.filter((c) => c.levels.includes(level));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLevel(opt.value)}
              className={`rounded px-3 py-1.5 transition-colors ${
                level === opt.value ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {level !== "sku" && (
          <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} className="accent-platform-meta" />
            Only show tagged {level === "campaign" ? "campaigns" : level === "adSet" ? "ad sets" : "ads"}
          </label>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        {data ? (
          <>
            <span className="font-medium text-ink-primary">{data.matchedAds}</span> of {data.totalAds} ads have a SKU tag in their name
            {data.totalAds > 0 && data.matchedAds < data.totalAds && ' — rename the rest to "FIG-..." to bring them in'}
          </>
        ) : (
          "Loading…"
        )}
      </p>

      {level === "sku" ? (
        <div className="rounded-md border border-status-good/30 bg-status-good/10 px-3 py-2 text-xs text-ink-secondary">
          <span className="font-medium text-status-good">This is the true number: </span>
          Every ad tagged with a SKU (across every campaign and ad set) is combined into one row here, so Spend is that SKU's real
          total spend and Website ROAS = that SKU's Shopify revenue ÷ its real total spend — not repeated at a different, distorted
          value per ad. Use this tab, not the Campaign/Ad Set/Ad tabs, when you want one honest ROAS per product.
        </div>
      ) : (
        <div className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-ink-secondary">
          <span className="font-medium text-status-warning">Directional, not exact: </span>
          Website Revenue is that SKU's <em>entire</em> Shopify revenue for the period, not revenue this specific ad/ad set/campaign
          caused — if multiple ads share the same SKU tag, each shows that SKU's full total against only its own spend, not split.
          Website ROAS gets extreme for very-low-spend or freshly-launched ads. For one honest ROAS per product, use the{" "}
          <button type="button" onClick={() => setLevel("sku")} className="underline hover:text-ink-primary">
            SKU (true ROAS)
          </button>{" "}
          tab instead.
        </div>
      )}

      <div className={`rounded-lg border border-border bg-surface-1 ${loading ? "opacity-60" : ""}`}>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{data ? "Nothing matches the current filters." : "Loading…"}</div>
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
                  <tr key={row.key} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`whitespace-nowrap px-4 py-2 tabular-nums ${
                          col.align === "right" ? "text-right text-ink-secondary" : "text-left text-ink-primary"
                        } ${["campaignName", "adSetName", "adName"].includes(col.key) ? "max-w-[220px] truncate font-medium" : ""}`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
