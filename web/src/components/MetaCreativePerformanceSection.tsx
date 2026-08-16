import { useEffect, useMemo, useState } from "react";
import type {
  MetaCreativePerformanceResponse,
  MetaCreativeAdRow,
  MetaCreativeAdSetGroup,
  MetaCreativeCampaignGroup,
  MetaCreativeProductGroup,
} from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchMetaCreativePerformance } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { normalizeStatus } from "../lib/campaignStatus";

interface Props {
  range: DateRange;
  refreshKey: number;
}

type Level = "campaign" | "adSet" | "ad" | "product";

// Flat row shapes per level -- each carries its parent names so the Ad Set
// and Ad views can show "which campaign/ad set is this" without nesting.
interface CampaignRow extends MetaCreativeCampaignGroup {
  key: string;
}
interface AdSetRow extends MetaCreativeAdSetGroup {
  key: string;
  campaignId: string;
  campaignName: string | null;
}
interface AdRowFlat extends MetaCreativeAdRow {
  key: string;
  campaignId: string;
  campaignName: string | null;
  adSetId: string;
  adSetName: string | null;
}
interface ProductRowFlat extends MetaCreativeProductGroup {
  key: string;
}

type AnyRow = CampaignRow | AdSetRow | AdRowFlat | ProductRowFlat;

function SkuBadge({ sku }: { sku: string | null }) {
  if (!sku) return <span className="text-xs italic text-ink-muted">no SKU tag</span>;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">{sku}</span>;
}

/** Small neutral pill for a parsed tag field -- format/angle/style/gender
 * are all the same "one of a fixed enum, or not tagged" shape. */
function TagPill({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-muted">—</span>;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-secondary">{value}</span>;
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
    levels: ["ad", "product"],
    sortValue: (r) => ("sku" in r ? (r as AdRowFlat | ProductRowFlat).sku : null),
    render: (r) => <SkuBadge sku={"sku" in r ? (r as AdRowFlat | ProductRowFlat).sku : null} />,
  },
  {
    key: "productTitle",
    label: "Product Name",
    align: "left",
    levels: ["product"],
    sortValue: (r) => ("productTitle" in r ? (r.productTitle ?? (r as ProductRowFlat).sku) : null),
    render: (r) => {
      if (!("productTitle" in r)) return "—";
      const g = r as ProductRowFlat;
      if (!g.productTitle) return <span className="text-ink-muted">—</span>;
      return (
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate" title={g.productTitle}>
            {g.productTitle}
          </span>
          {g.variantCount > 1 && <span className="shrink-0 text-xs text-ink-muted">+{g.variantCount - 1} more</span>}
        </span>
      );
    },
  },
  {
    key: "format",
    label: "Format",
    align: "left",
    levels: ["ad"],
    sortValue: (r) => ("format" in r ? r.format : null),
    render: (r) => <TagPill value={"format" in r ? r.format : null} />,
  },
  {
    key: "angle",
    label: "Angle",
    align: "left",
    levels: ["ad"],
    sortValue: (r) => ("angle" in r ? r.angle : null),
    render: (r) => <TagPill value={"angle" in r ? r.angle : null} />,
  },
  {
    key: "style",
    label: "Style",
    align: "left",
    levels: ["ad"],
    sortValue: (r) => ("style" in r ? r.style : null),
    render: (r) => <TagPill value={"style" in r ? r.style : null} />,
  },
  {
    key: "gender",
    label: "Gender",
    align: "left",
    levels: ["ad"],
    sortValue: (r) => ("gender" in r ? r.gender : null),
    render: (r) => <TagPill value={"gender" in r ? r.gender : null} />,
  },
  {
    key: "version",
    label: "Version",
    align: "right",
    levels: ["ad"],
    sortValue: (r) => ("version" in r ? r.version : null),
    render: (r) => ("version" in r && r.version != null ? `v${r.version}` : <span className="text-ink-muted">—</span>),
  },
  {
    key: "variant",
    label: "Variant",
    align: "right",
    levels: ["ad"],
    sortValue: (r) => ("variant" in r ? r.variant : null),
    render: (r) => ("variant" in r && r.variant != null ? `n${r.variant}` : <span className="text-ink-muted">—</span>),
  },
  {
    key: "creativeCount",
    label: "Creatives",
    align: "right",
    levels: ["product"],
    sortValue: (r) => ("creativeCount" in r ? r.creativeCount : null),
    render: (r) => ("creativeCount" in r ? formatNumber(r.creativeCount) : "—"),
  },
  {
    key: "campaignCount",
    label: "Campaigns",
    align: "right",
    levels: ["product"],
    sortValue: (r) => ("campaignCount" in r ? r.campaignCount : null),
    render: (r) => ("campaignCount" in r ? formatNumber(r.campaignCount) : "—"),
  },
  {
    key: "spend",
    label: "Spend",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.spend,
    render: (r) => formatCurrency(r.spend),
  },
  {
    key: "impressions",
    label: "Impr.",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.impressions,
    render: (r) => formatNumber(r.impressions),
  },
  {
    key: "clicks",
    label: "Clicks",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.clicks,
    render: (r) => formatNumber(r.clicks),
  },
  { key: "ctr", label: "CTR", align: "right", levels: ["campaign", "adSet", "ad", "product"], sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  { key: "cvr", label: "CVR", align: "right", levels: ["campaign", "adSet", "ad", "product"], sortValue: (r) => r.cvr, render: (r) => formatPercent(r.cvr) },
  { key: "cpc", label: "CPC", align: "right", levels: ["campaign", "adSet", "ad", "product"], sortValue: (r) => r.cpc, render: (r) => formatCurrency(r.cpc) },
  { key: "cpa", label: "CPA", align: "right", levels: ["campaign", "adSet", "ad", "product"], sortValue: (r) => r.cpa, render: (r) => formatCurrency(r.cpa) },
  {
    key: "conversions",
    label: "Orders",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.conversions,
    render: (r) => formatNumber(r.conversions),
  },
  {
    key: "adsRevenue",
    label: "Ads Revenue",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.adsRevenue,
    render: (r) => formatCurrency(r.adsRevenue),
  },
  {
    key: "adsRoas",
    label: "Ads ROAS",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.adsRoas,
    render: (r) => <RoasCell value={r.adsRoas} />,
  },
  {
    key: "websiteRevenue",
    label: "Website Revenue",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.websiteRevenue,
    render: (r) => formatCurrency(r.websiteRevenue),
  },
  {
    key: "websiteRoas",
    label: "Website ROAS",
    align: "right",
    levels: ["campaign", "adSet", "ad", "product"],
    sortValue: (r) => r.websiteRoas,
    render: (r) => <RoasCell value={r.websiteRoas} />,
  },
];

const SEARCH_PLACEHOLDER: Record<Level, string> = {
  campaign: "Search campaign…",
  adSet: "Search campaign or ad set…",
  ad: "Search campaign, ad set, ad, or SKU…",
  product: "Search SKU or product name…",
};

const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "campaign", label: "Campaign" },
  { value: "adSet", label: "Ad Set" },
  { value: "ad", label: "Creative (Ad)" },
  { value: "product", label: "Product (true ROAS)" },
];

function matchesSearch(row: AnyRow, level: Level, term: string): boolean {
  if (!term) return true;
  const haystacks: (string | null | undefined)[] = [];
  if ("campaignName" in row) haystacks.push(row.campaignName, row.campaignId);
  if ("adSetName" in row) haystacks.push(row.adSetName, row.adSetId);
  if (level === "ad") haystacks.push((row as AdRowFlat).adName, (row as AdRowFlat).adId, (row as AdRowFlat).sku);
  if (level === "product") haystacks.push((row as ProductRowFlat).sku, (row as ProductRowFlat).productTitle);
  return haystacks.some((h) => h?.toLowerCase().includes(term));
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface PerfFields {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  adsRevenue: number;
  websiteRevenue: number | null;
}

interface Rollup {
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

/** Weighted rollup (sum/sum, never averaged) over any set of rows carrying
 * the standard performance fields -- used for both the pinned Total row
 * (any level) and the attribute breakdown panel (Creative level only). */
function rollUpPerf<T extends PerfFields>(rows: T[]): Rollup {
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

/** Renders a Totals-row cell for a given column -- name/SKU/status/tag/count
 * columns aren't summable, so those show "—". */
function renderTotalCell(colKey: string, totals: Rollup): React.ReactNode {
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
      return "—";
  }
}

function compareValues(av: number | string | null, bv: number | string | null, dir: "asc" | "desc"): number {
  const aNull = av == null;
  const bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls always sort last
  if (bNull) return -1;
  const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av < bv ? -1 : av > bv ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

// --- "Which type of creative performs best" breakdown (Creative level only) -

type AttributeDimension = "format" | "angle" | "style" | "gender";

const DIMENSION_OPTIONS: { value: AttributeDimension; label: string }[] = [
  { value: "format", label: "Format" },
  { value: "angle", label: "Angle" },
  { value: "style", label: "Style" },
  { value: "gender", label: "Gender" },
];

interface AttributeBreakdownRow extends Rollup {
  value: string;
  creativeCount: number;
}

function computeAttributeBreakdown(ads: AdRowFlat[], dim: AttributeDimension): AttributeBreakdownRow[] {
  const groups = new Map<string, AdRowFlat[]>();
  for (const ad of ads) {
    const key = ad[dim] ?? "Not tagged";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ad);
  }
  return [...groups.entries()]
    .map(([value, adsInGroup]) => ({ value, creativeCount: adsInGroup.length, ...rollUpPerf(adsInGroup) }))
    .sort((a, b) => b.spend - a.spend);
}

function AttributeBreakdownPanel({ ads }: { ads: AdRowFlat[] }) {
  const [dim, setDim] = useState<AttributeDimension>("format");
  const rows = useMemo(() => computeAttributeBreakdown(ads, dim), [ads, dim]);

  if (ads.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Which {DIMENSION_OPTIONS.find((d) => d.value === dim)?.label.toLowerCase()} performs best</h4>
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {DIMENSION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDim(opt.value)}
              className={`rounded px-2.5 py-1 transition-colors ${
                dim === opt.value ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                {DIMENSION_OPTIONS.find((d) => d.value === dim)?.label}
              </th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Creatives</th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Spend</th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CTR</th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CVR</th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Ads ROAS</th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Website ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.value} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                <td className="whitespace-nowrap px-4 py-2 font-medium text-ink-primary">
                  {r.value === "Not tagged" ? <span className="italic text-ink-muted">Not tagged</span> : <TagPill value={r.value} />}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(r.creativeCount)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.spend)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.ctr)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.cvr)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">
                  <RoasCell value={r.adsRoas} />
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">
                  <RoasCell value={r.websiteRoas} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MetaCreativePerformanceSection({ range, refreshKey }: Props) {
  const [data, setData] = useState<MetaCreativePerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<Level>("campaign");
  const [onlyMatched, setOnlyMatched] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMetaCreativePerformance(range.from, range.to)
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
      return onlyMatched ? adRows.filter((a) => a.tagged) : adRows;
    }
    // "product" level -- every row already has a SKU by construction, so
    // onlyMatched is a no-op here.
    const productRows: ProductRowFlat[] = data.products.map((g) => ({ ...g, key: g.sku }));
    return productRows;
  }, [data, level, onlyMatched]);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term ? rows.filter((r) => matchesSearch(r, level, term)) : rows;
    const col = COLUMNS.find((c) => c.key === sortKey && c.levels.includes(level));
    if (!col) return filtered;
    return [...filtered].sort((a, b) => compareValues(col.sortValue(a), col.sortValue(b), sortDir));
  }, [rows, sortKey, sortDir, level, search]);

  const totals = useMemo(() => rollUpPerf(sorted), [sorted]);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  /** Product tab -> click a SKU to jump straight to that product's full
   * creative breakdown (status, format/angle/style/gender, individual
   * performance) on the Creative tab -- the "this product has N creatives,
   * here's how each is doing" view the SKU is a shortcut into. */
  function jumpToSku(sku: string) {
    setLevel("ad");
    setSearch(sku);
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
        <div className="flex items-center gap-3">
          {level !== "product" && (
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} className="accent-platform-meta" />
              Only show tagged {level === "campaign" ? "campaigns" : level === "adSet" ? "ad sets" : "creatives"}
            </label>
          )}
          <input
            type="text"
            placeholder={SEARCH_PLACEHOLDER[level]}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
          />
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        {data ? (
          <>
            <span className="font-medium text-ink-primary">{data.taggedAds}</span> of {data.totalAds} ads carry a full creative tag
            ({"$"}SKU_Format_Angle_Style_Gender_v(n)_n(n){"$"})
            {data.matchedAds > data.taggedAds && <> — {data.matchedAds} have at least a SKU inside the tag</>}
            {data.totalAds > 0 && data.taggedAds === 0 && " — none yet; this lights up once ad names start wrapping the tag in \"$...$\""}
          </>
        ) : (
          "Loading…"
        )}
      </p>

      {level === "product" ? (
        <div className="rounded-md border border-status-good/30 bg-status-good/10 px-3 py-2 text-xs text-ink-secondary">
          <span className="font-medium text-status-good">This is the true number: </span>
          Every creative tagged with a SKU (across every campaign and ad set) is combined into one row here, so Spend is that
          product's real total spend and Website ROAS = that product's Shopify revenue ÷ its real total spend. Click a SKU to see
          every individual creative behind that number — performance and status — on the Creative tab.
        </div>
      ) : (
        <div className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-ink-secondary">
          <span className="font-medium text-status-warning">Directional, not exact: </span>
          Website Revenue is that SKU's <em>entire</em> Shopify revenue for the period, not revenue this specific
          ad/ad set/campaign caused — if multiple creatives share the same SKU, each shows that SKU's full total against only its
          own spend, not split. For one honest ROAS per product, use the{" "}
          <button type="button" onClick={() => setLevel("product")} className="underline hover:text-ink-primary">
            Product (true ROAS)
          </button>{" "}
          tab instead.
        </div>
      )}

      {level === "ad" && <AttributeBreakdownPanel ads={sorted as AdRowFlat[]} />}

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
                        } ${["campaignName", "adSetName", "adName", "productTitle"].includes(col.key) ? "max-w-[220px] truncate font-medium" : ""}`}
                      >
                        {col.key === "sku" && level === "product" && (row as ProductRowFlat).sku ? (
                          <button
                            type="button"
                            onClick={() => jumpToSku((row as ProductRowFlat).sku)}
                            className="hover:underline"
                            title="See every creative for this product"
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
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
