import { useEffect, useMemo, useState } from "react";
import type { GoogleSkuAttributionResponse, GoogleSkuProductRow, GoogleSkuCampaignGroup, GoogleSkuGroupRow } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchGoogleSkuAttribution } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { RankedBarChart } from "./RankedBarChart";
import { KpiTile } from "./KpiTile";
import { InfoNote } from "./InfoNote";
import { ExportMenu } from "./ExportMenu";
import type { ExportColumn } from "../lib/exportTable";

interface Props {
  range: DateRange;
  refreshKey: number;
  targetRoas: number;
}

// Two levels, not four -- Shopping/PMax has no ad-group/ad tier in this data
// at all (a product-item row IS the leaf), see GoogleSkuAttributionResponse's
// header comment in shared/src/index.ts. Campaign > Product is the real
// structure, plus the same "SKU (true ROAS)" combined-across-campaigns view
// Meta's page has.
type Level = "campaign" | "product" | "sku";

interface CampaignRow extends GoogleSkuCampaignGroup {
  key: string;
}
interface ProductRowFlat extends GoogleSkuProductRow {
  key: string;
  campaignId: string;
  campaignName: string | null;
}
interface SkuGroupRowFlat extends GoogleSkuGroupRow {
  key: string;
}

type AnyRow = CampaignRow | ProductRowFlat | SkuGroupRowFlat;

function SkuBadge({ sku }: { sku: string | null }) {
  if (!sku) return <span className="text-xs italic text-ink-muted">no match</span>;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">{sku}</span>;
}

function RoasCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-muted">N/A</span>;
  const extreme = value > 100;
  return <span className={extreme ? "text-status-warning" : undefined}>{formatMultiplier(value)}</span>;
}

interface Column {
  key: string;
  label: string;
  align: "left" | "right";
  levels: Level[];
  sortValue: (r: AnyRow) => number | string | null;
  render: (r: AnyRow) => React.ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: "campaignName",
    label: "Campaign",
    align: "left",
    levels: ["campaign", "product"],
    sortValue: (r) => ("campaignName" in r ? (r.campaignName ?? r.campaignId) : null),
    render: (r) => ("campaignName" in r ? (r.campaignName ?? r.campaignId) : "N/A"),
  },
  {
    key: "productTitle",
    label: "Product",
    align: "left",
    levels: ["product", "sku"],
    sortValue: (r) => ("productTitle" in r ? (r.productTitle ?? (r as ProductRowFlat | SkuGroupRowFlat).sku) : null),
    render: (r) => {
      if (!("productTitle" in r)) return "N/A";
      const title = r.productTitle;
      if (!title) return <span className="text-ink-muted">N/A</span>;
      return (
        <span className="block max-w-[220px] truncate" title={title}>
          {title}
        </span>
      );
    },
  },
  {
    key: "sku",
    label: "SKU",
    align: "left",
    levels: ["product", "sku"],
    sortValue: (r) => ("sku" in r ? (r as ProductRowFlat | SkuGroupRowFlat).sku : null),
    render: (r) => <SkuBadge sku={"sku" in r ? (r as ProductRowFlat | SkuGroupRowFlat).sku : null} />,
  },
  {
    key: "productItemCount",
    label: "Product Items",
    align: "right",
    levels: ["sku"],
    sortValue: (r) => ("productItemCount" in r ? r.productItemCount : null),
    render: (r) => ("productItemCount" in r ? formatNumber(r.productItemCount) : "N/A"),
  },
  {
    key: "campaignCount",
    label: "Campaigns",
    align: "right",
    levels: ["sku"],
    sortValue: (r) => ("campaignCount" in r ? r.campaignCount : null),
    render: (r) => ("campaignCount" in r ? formatNumber(r.campaignCount) : "N/A"),
  },
  {
    key: "spend",
    label: "Spend",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.spend,
    render: (r) => formatCurrency(r.spend),
  },
  {
    key: "impressions",
    label: "Impr.",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.impressions,
    render: (r) => formatNumber(r.impressions),
  },
  {
    key: "clicks",
    label: "Clicks",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.clicks,
    render: (r) => formatNumber(r.clicks),
  },
  { key: "ctr", label: "CTR", align: "right", levels: ["campaign", "product", "sku"], sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  { key: "cvr", label: "CVR", align: "right", levels: ["campaign", "product", "sku"], sortValue: (r) => r.cvr, render: (r) => formatPercent(r.cvr) },
  { key: "cpc", label: "CPC", align: "right", levels: ["campaign", "product", "sku"], sortValue: (r) => r.cpc, render: (r) => formatCurrency(r.cpc) },
  { key: "cpa", label: "CPA", align: "right", levels: ["campaign", "product", "sku"], sortValue: (r) => r.cpa, render: (r) => formatCurrency(r.cpa) },
  {
    key: "conversions",
    label: "Orders",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.conversions,
    render: (r) => formatNumber(r.conversions),
  },
  {
    key: "adsRevenue",
    label: "Ads Revenue",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.adsRevenue,
    render: (r) => formatCurrency(r.adsRevenue),
  },
  {
    key: "adsRoas",
    label: "Ads ROAS",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.adsRoas,
    render: (r) => <RoasCell value={r.adsRoas} />,
  },
  {
    key: "websiteRevenue",
    label: "Website Revenue",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.websiteRevenue,
    render: (r) => formatCurrency(r.websiteRevenue),
  },
  {
    key: "websiteRoas",
    label: "Website ROAS",
    align: "right",
    levels: ["campaign", "product", "sku"],
    sortValue: (r) => r.websiteRoas,
    render: (r) => <RoasCell value={r.websiteRoas} />,
  },
];

const SEARCH_PLACEHOLDER: Record<Level, string> = {
  campaign: "Search campaign…",
  product: "Search campaign, product, or SKU…",
  sku: "Search SKU or product name…",
};

const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "product", label: "Product" },
  { value: "sku", label: "SKU (true ROAS)" },
];

function matchesSearch(row: AnyRow, level: Level, term: string): boolean {
  if (!term) return true;
  const haystacks: (string | null | undefined)[] = [];
  if ("campaignName" in row) haystacks.push(row.campaignName, row.campaignId);
  if (level === "product") haystacks.push((row as ProductRowFlat).productTitle, (row as ProductRowFlat).sku);
  if (level === "sku") haystacks.push((row as SkuGroupRowFlat).sku, (row as SkuGroupRowFlat).productTitle);
  return haystacks.some((h) => h?.toLowerCase().includes(term));
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cvr: number | null;
  cpc: number | null;
  cpa: number | null;
  adsRevenue: number;
  adsRoas: number | null;
  websiteRevenue: number | null;
  websiteRoas: number | null;
}

function computeTotals(rows: AnyRow[]): Totals {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  const adsRevenue = rows.reduce((s, r) => s + r.adsRevenue, 0);
  const matched = rows.filter((r) => r.websiteRevenue != null);
  const websiteRevenue = matched.length > 0 ? matched.reduce((s, r) => s + (r.websiteRevenue ?? 0), 0) : null;
  return {
    spend,
    impressions,
    clicks,
    conversions,
    ctr: safeDivide(clicks, impressions),
    cvr: safeDivide(conversions, clicks),
    cpc: safeDivide(spend, clicks),
    cpa: safeDivide(spend, conversions),
    adsRevenue,
    adsRoas: safeDivide(adsRevenue, spend),
    websiteRevenue,
    websiteRoas: websiteRevenue != null ? safeDivide(websiteRevenue, spend) : null,
  };
}

function renderTotalCell(colKey: string, totals: Totals): React.ReactNode {
  switch (colKey) {
    case "spend":
      return formatCurrency(totals.spend);
    case "impressions":
      return formatNumber(totals.impressions);
    case "clicks":
      return formatNumber(totals.clicks);
    case "ctr":
      return formatPercent(totals.ctr);
    case "cvr":
      return formatPercent(totals.cvr);
    case "cpc":
      return formatCurrency(totals.cpc);
    case "cpa":
      return formatCurrency(totals.cpa);
    case "conversions":
      return formatNumber(totals.conversions);
    case "adsRevenue":
      return formatCurrency(totals.adsRevenue);
    case "adsRoas":
      return <RoasCell value={totals.adsRoas} />;
    case "websiteRevenue":
      return formatCurrency(totals.websiteRevenue);
    case "websiteRoas":
      return <RoasCell value={totals.websiteRoas} />;
    default:
      return "N/A";
  }
}

function compareValues(av: number | string | null, bv: number | string | null, dir: "asc" | "desc"): number {
  const aNull = av == null;
  const bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av < bv ? -1 : av > bv ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

export function GoogleSkuAttributionSection({ range, refreshKey, targetRoas }: Props) {
  const [data, setData] = useState<GoogleSkuAttributionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<Level>("campaign");
  const [onlyMatched, setOnlyMatched] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGoogleSkuAttribution(range.from, range.to)
      .then((res) => !cancelled && setData(res))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshKey]);

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
    if (level === "product") {
      const productRows: ProductRowFlat[] = data.campaigns.flatMap((c) =>
        c.products.map((p) => ({ ...p, key: `${c.campaignId}|${p.productItemId}`, campaignId: c.campaignId, campaignName: c.campaignName }))
      );
      return onlyMatched ? productRows.filter((p) => p.sku != null) : productRows;
    }
    const skuRows: SkuGroupRowFlat[] = data.skuGroups.map((g) => ({ ...g, key: g.sku }));
    return skuRows;
  }, [data, level, onlyMatched]);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term ? rows.filter((r) => matchesSearch(r, level, term)) : rows;
    const col = COLUMNS.find((c) => c.key === sortKey && c.levels.includes(level));
    if (!col) return filtered;
    return [...filtered].sort((a, b) => compareValues(col.sortValue(a), col.sortValue(b), sortDir));
  }, [rows, sortKey, sortDir, level, search]);

  const totals = useMemo(() => computeTotals(sorted), [sorted]);

  const topSkus = useMemo(() => [...(data?.skuGroups ?? [])].sort((a, b) => b.spend - a.spend).slice(0, 8), [data]);
  const selectedGroup = useMemo(() => data?.skuGroups.find((g) => g.sku === selectedSku) ?? null, [data, selectedSku]);
  const summary = selectedGroup ?? computeTotals((data?.skuGroups ?? []).map((g) => ({ ...g, key: g.sku })));
  const atOrAboveTarget = (data?.skuGroups ?? []).filter((g) => g.websiteRoas != null && g.websiteRoas >= targetRoas).length;
  const matchedSkuCount = (data?.skuGroups ?? []).filter((g) => g.websiteRoas != null).length;

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const columns = COLUMNS.filter((c) => c.levels.includes(level));

  const exportColumns: ExportColumn<AnyRow>[] = columns.map((col) => {
    const isPercent = col.key === "ctr" || col.key === "cvr";
    return {
      header: isPercent ? `${col.label} (%)` : col.label,
      accessor: (r) => {
        const v = col.sortValue(r);
        if (v == null || typeof v === "string") return v;
        return isPercent ? Number((v * 100).toFixed(2)) : v;
      },
    };
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="font-display text-base text-ink-primary">Top SKUs by spend</h3>
            <InfoNote label="How this chart works">
              Bar length is that SKU's real total spend (every Shopping/PMax product item that resolved to it, combined
              across campaigns); color is its true Website ROAS vs. the {formatMultiplier(targetRoas)} target -- red is
              below, green is at or above. Unlike Meta's name-tag guess, this match is exact: Google's product_item_id
              decodes straight to the Shopify product/variant ID, no regex. Click a bar to see that SKU's full
              breakdown below; click again (or nothing) to see the total across all matched SKUs.
            </InfoNote>
          </div>
          <p className="text-xs text-ink-muted">
            {matchedSkuCount > 0 ? (
              <>
                <span className="font-medium text-ink-primary">{atOrAboveTarget}</span> of {matchedSkuCount} SKUs at or
                above target ROAS ({formatMultiplier(targetRoas)})
              </>
            ) : (
              "No SKU has both spend and Shopify revenue yet"
            )}
          </p>
        </div>
        <RankedBarChart
          items={topSkus.map((g) => ({
            key: g.sku,
            label: g.productTitle ?? g.sku,
            sublabel: g.sku,
            value: g.spend,
            roas: g.websiteRoas,
          }))}
          targetRoas={targetRoas}
          valueFormatter={(v) => formatCurrency(v)}
          selectedKey={selectedSku}
          onSelect={(key) => setSelectedSku((cur) => (cur === key ? null : key))}
          emptyMessage="No matched product items yet -- this fills in once Shopping/PMax campaigns are syncing"
        />

        <div className="mt-4 flex items-center gap-1.5 text-xs text-ink-muted">
          {selectedGroup ? (
            <>
              Showing <span className="font-medium text-ink-primary">{selectedGroup.productTitle ?? selectedGroup.sku}</span> ({selectedGroup.sku})
            </>
          ) : (
            "Showing the total across every matched SKU"
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="Spend" value={formatCurrency(summary.spend)} numeric={summary.spend} numericFormat="currency" />
          <KpiTile label="Clicks" value={formatNumber(summary.clicks)} numeric={summary.clicks} numericFormat="number" />
          <KpiTile label="CPC" value={formatCurrency(summary.cpc)} />
          <KpiTile label="CPA" value={formatCurrency(summary.cpa)} />
          <KpiTile label="Google Revenue" value={formatCurrency(summary.adsRevenue)} numeric={summary.adsRevenue} numericFormat="currency" />
          <KpiTile label="Ads ROAS" value={formatMultiplier(summary.adsRoas)} />
          <KpiTile label="Website Revenue" value={formatCurrency(summary.websiteRevenue)} numeric={summary.websiteRevenue} numericFormat="currency" />
          <KpiTile label="Website ROAS" value={formatMultiplier(summary.websiteRoas)} sublabel={`target ${formatMultiplier(targetRoas)}`} />
        </div>
      </div>

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
        <div className="flex items-center gap-3">
          {level !== "sku" && (
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} className="accent-platform-google" />
              Only show matched {level === "campaign" ? "campaigns" : "products"}
            </label>
          )}
          <input
            type="text"
            placeholder={SEARCH_PLACEHOLDER[level]}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
          />
          <ExportMenu filename={`google-sku-attribution-${level}`} title="Google SKU Attribution" columns={exportColumns} rows={sorted} />
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        {data ? (
          <>
            <span className="font-medium text-ink-primary">{data.matchedProductItems}</span> of {data.totalProductItems} Shopping/PMax product items
            matched a Shopify variant
            {data.totalProductItems > 0 && data.matchedProductItems < data.totalProductItems && " — the rest didn't resolve to a known product/variant ID"}
          </>
        ) : (
          "Loading…"
        )}
      </p>

      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        {level === "sku" ? (
          <>
            <InfoNote tone="good" label="Why this is the true number">
              Every product item that resolved to this SKU (across every campaign) is combined into one row here, so
              Spend is that SKU's real total spend and Website ROAS = that SKU's Shopify revenue divided by its real
              total spend -- an exact match, not a name-tag guess.
            </InfoNote>
            This tab is the true number for one honest ROAS per product.
          </>
        ) : (
          <>
            <InfoNote tone="good" label="Exact match, not directional">
              Unlike Meta's Ad/Ad Set/Campaign tabs, Google's Campaign and Product tabs are already exact -- each
              product item's spend and revenue come straight from Shopping/PMax's own per-product reporting, not a
              shared total split across ads. The SKU tab exists only to combine the same SKU across multiple
              campaigns, not to fix directional numbers.
            </InfoNote>
          </>
        )}
      </div>

      <div className={`rounded-2xl border border-border bg-surface-1 ${loading ? "opacity-60" : ""}`}>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{data ? "Nothing matches the current filters." : "Loading…"}</div>
        ) : (
          <div className="table-scroll-pane">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className={`sticky-thead cursor-pointer select-none whitespace-nowrap bg-surface-1 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary ${
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
                <tr className="border-b-2 border-border bg-surface-2/40 font-semibold">
                  {columns.map((col, i) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-4 py-2 tabular-nums ${
                        col.align === "right" ? "text-right text-ink-secondary" : "text-left text-ink-primary"
                      }`}
                    >
                      {i === 0 ? `Total (${sorted.length})` : renderTotalCell(col.key, totals)}
                    </td>
                  ))}
                </tr>
                {sorted.map((row) => (
                  <tr key={row.key} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`whitespace-nowrap px-4 py-2 tabular-nums ${
                          col.align === "right" ? "text-right text-ink-secondary" : "text-left text-ink-primary"
                        } ${["campaignName", "productTitle"].includes(col.key) ? "max-w-[220px] truncate font-medium" : ""}`}
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
