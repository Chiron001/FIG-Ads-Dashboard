import { useEffect, useMemo, useState } from "react";
import type { MetaCreativePerformanceResponse, MetaCreativeAdRow } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchMetaCreativePerformance } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { normalizeStatus } from "../lib/campaignStatus";
import { RankedBarChart } from "./RankedBarChart";
import { InfoNote } from "./InfoNote";

interface Props {
  range: DateRange;
  refreshKey: number;
  targetRoas: number;
}

function SkuBadge({ sku }: { sku: string | null }) {
  if (!sku) return <span className="text-xs italic text-ink-muted">not tagged</span>;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">{sku}</span>;
}

function TagPill({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-muted">N/A</span>;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-secondary">{value}</span>;
}

function RoasCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-muted">N/A</span>;
  const extreme = value > 100;
  return <span className={extreme ? "text-status-warning" : undefined}>{formatMultiplier(value)}</span>;
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** One row per distinct CREATIVE -- every ad sharing the exact same parsed
 * tag (sku + format + angle + style + gender + version + variant) is one
 * creative reused across however many ads/ad sets/campaigns it's placed
 * in, combined into one row here instead of shown once per placement.
 * websiteRevenue/websiteRoas are NOT summed across the group's ads --
 * every ad sharing one SKU carries that SKU's identical full total (see
 * the ads-attribution caveat elsewhere in the app), so summing them would
 * multiply the same number by however many ads used this creative. Taken
 * once instead, then divided by the group's real combined spend. */
interface CreativeGroup {
  creativeKey: string;
  sku: string;
  productTitle: string | null;
  format: string | null;
  angle: string | null;
  style: string | null;
  gender: string | null;
  version: number | null;
  variant: number | null;
  statusSummary: string;
  adCount: number;
  adSetCount: number;
  campaignCount: number;
  adNames: string[];
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

interface FlatAd extends MetaCreativeAdRow {
  campaignId: string;
  campaignName: string | null;
  adSetId: string;
  adSetName: string | null;
}

function groupByCreative(ads: FlatAd[], productTitleForSku: (sku: string) => string | null): CreativeGroup[] {
  const groups = new Map<string, FlatAd[]>();
  for (const ad of ads) {
    if (!ad.tagged || !ad.sku) continue; // an ungrouped ad has no creative identity to group by
    const key = [ad.sku, ad.format, ad.angle, ad.style, ad.gender, ad.version, ad.variant].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ad);
  }

  return [...groups.entries()].map(([creativeKey, members]): CreativeGroup => {
    const first = members[0];
    const spend = members.reduce((s, a) => s + a.spend, 0);
    const impressions = members.reduce((s, a) => s + a.impressions, 0);
    const clicks = members.reduce((s, a) => s + a.clicks, 0);
    const conversions = members.reduce((s, a) => s + a.conversions, 0);
    const adsRevenue = members.reduce((s, a) => s + a.adsRevenue, 0);
    // Identical across every member by construction (same sku) -- take
    // once, not summed.
    const websiteRevenue = first.websiteRevenue;
    const statuses = new Set(members.map((a) => normalizeStatus(a.adStatus).label));

    return {
      creativeKey,
      sku: first.sku!,
      productTitle: productTitleForSku(first.sku!),
      format: first.format,
      angle: first.angle,
      style: first.style,
      gender: first.gender,
      version: first.version,
      variant: first.variant,
      statusSummary: statuses.size === 1 ? [...statuses][0] : `${statuses.size} statuses`,
      adCount: members.length,
      adSetCount: new Set(members.map((a) => a.adSetId)).size,
      campaignCount: new Set(members.map((a) => a.campaignId)).size,
      adNames: members.map((a) => a.adName ?? a.adId),
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
  });
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
}

/** Weighted rollup (sum/sum, never averaged) for the pinned Total row --
 * ads-side fields only. Website Revenue/ROAS deliberately excluded: two
 * creatives can share one SKU, and each already carries that SKU's full
 * total, so summing across creative rows would multiply real revenue by
 * however many creatives happen to share a product -- there's no way to
 * total it here that isn't misleading. The SKU Attribution page's
 * "SKU (true ROAS)" tab is the one place that number is safe to total. */
function computeTotals(rows: CreativeGroup[]): Totals {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  const adsRevenue = rows.reduce((s, r) => s + r.adsRevenue, 0);
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
  };
}

function creativeName(g: CreativeGroup): string {
  return [g.sku, g.format, g.angle, g.style, g.gender, g.version != null ? `v${g.version}` : null, g.variant != null ? `n${g.variant}` : null]
    .filter(Boolean)
    .join("_");
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

type RankMetric = "spend" | "adsRoas" | "websiteRoas";
const RANK_OPTIONS: { value: RankMetric; label: string }[] = [
  { value: "spend", label: "Spend" },
  { value: "adsRoas", label: "Ads ROAS" },
  { value: "websiteRoas", label: "Website ROAS" },
];

export function MetaCreativePerformanceSection({ range, refreshKey, targetRoas }: Props) {
  const [data, setData] = useState<MetaCreativePerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [rankMetric, setRankMetric] = useState<RankMetric>("spend");
  const [selectedCreative, setSelectedCreative] = useState<string | null>(null);

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

  const flatAds = useMemo((): FlatAd[] => {
    if (!data) return [];
    return data.campaigns.flatMap((c) =>
      c.adSets.flatMap((s) => s.ads.map((a) => ({ ...a, campaignId: c.campaignId, campaignName: c.campaignName, adSetId: s.adSetId, adSetName: s.adSetName })))
    );
  }, [data]);

  const productTitleForSku = useMemo(() => {
    const bySku = new Map((data?.products ?? []).map((p) => [p.sku, p.productTitle]));
    return (sku: string) => bySku.get(sku) ?? null;
  }, [data]);

  const creatives = useMemo(() => groupByCreative(flatAds, productTitleForSku), [flatAds, productTitleForSku]);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? creatives.filter(
          (c) =>
            creativeName(c).toLowerCase().includes(term) ||
            c.sku.toLowerCase().includes(term) ||
            (c.productTitle ?? "").toLowerCase().includes(term) ||
            c.adNames.some((n) => n.toLowerCase().includes(term))
        )
      : creatives;
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, number | string | null>)[sortKey];
      const bv = (b as unknown as Record<string, number | string | null>)[sortKey];
      return compareValues(av, bv, sortDir);
    });
  }, [creatives, search, sortKey, sortDir]);

  const totals = useMemo(() => computeTotals(sorted), [sorted]);

  const topCreatives = useMemo(
    () =>
      [...creatives]
        .filter((c) => (rankMetric === "spend" ? c.spend > 0 : c[rankMetric] != null))
        .sort((a, b) => (b[rankMetric] ?? -Infinity) - (a[rankMetric] ?? -Infinity))
        .slice(0, 8),
    [creatives, rankMetric]
  );

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const taggedAdCount = flatAds.filter((a) => a.tagged).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="font-display text-base text-ink-primary">Top creatives</h3>
            <InfoNote label="How this chart works">
              Every ad sharing the exact same parsed tag (SKU + format + angle + style + gender + version + variant)
              is one creative here, combined across however many ads/campaigns it's placed in. Rank by spend or
              either ROAS; click a bar to filter the table below to that creative.
            </InfoNote>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
            {RANK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRankMetric(opt.value)}
                className={`rounded px-2.5 py-1 transition-colors ${
                  rankMetric === opt.value ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                Rank by {opt.label}
              </button>
            ))}
          </div>
        </div>
        <RankedBarChart
          items={topCreatives.map((c) => ({
            key: c.creativeKey,
            label: c.productTitle ?? c.sku,
            sublabel: [c.format, c.angle, c.style].filter(Boolean).join(" · ") || c.sku,
            value: rankMetric === "spend" ? c.spend : (c[rankMetric] ?? 0),
            roas: c.websiteRoas,
          }))}
          targetRoas={targetRoas}
          valueFormatter={(v) => (rankMetric === "spend" ? formatCurrency(v) : formatMultiplier(v))}
          selectedKey={selectedCreative}
          onSelect={(key) => {
            setSelectedCreative((cur) => (cur === key ? null : key));
            const c = creatives.find((x) => x.creativeKey === key);
            setSearch((cur) => (selectedCreative === key ? "" : (c ? c.sku : cur)));
          }}
          emptyMessage="No tagged creatives yet -- this fills in once ad names start wrapping the tag in &quot;$...$&quot;"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {data ? (
            <>
              <span className="font-medium text-ink-primary">{creatives.length}</span> distinct creatives from{" "}
              <span className="font-medium text-ink-primary">{taggedAdCount}</span> tagged ads (of {data.totalAds} total)
            </>
          ) : (
            "Loading…"
          )}
        </p>
        <input
          type="text"
          placeholder="Search creative, SKU, product, or ad name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedCreative(null);
          }}
          className="w-64 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
        />
      </div>

      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <InfoNote tone="warning" label="Why Website Revenue is directional">
          Website Revenue is that SKU's entire Shopify revenue for the period, not revenue this specific creative
          caused -- if multiple creatives share the same SKU, each shows that SKU's full total against only its own
          spend, not split.
        </InfoNote>
        Website figures here are directional. For one honest ROAS per product, see the SKU Attribution page.
      </div>

      <div className={`rounded-2xl border border-border bg-surface-1 ${loading ? "opacity-60" : ""}`}>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{data ? "Nothing matches the current filters." : "Loading…"}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {[
                    { key: "creativeName", label: "Creative", align: "left" },
                    { key: "productTitle", label: "Product", align: "left" },
                    { key: "statusSummary", label: "Status", align: "left" },
                    { key: "format", label: "Format", align: "left" },
                    { key: "angle", label: "Angle", align: "left" },
                    { key: "style", label: "Style", align: "left" },
                    { key: "gender", label: "Gender", align: "left" },
                    { key: "adCount", label: "Ads", align: "right" },
                    { key: "adSetCount", label: "Ad Sets", align: "right" },
                    { key: "campaignCount", label: "Campaigns", align: "right" },
                    { key: "spend", label: "Spend", align: "right" },
                    { key: "impressions", label: "Impr.", align: "right" },
                    { key: "clicks", label: "Clicks", align: "right" },
                    { key: "ctr", label: "CTR", align: "right" },
                    { key: "cvr", label: "CVR", align: "right" },
                    { key: "cpc", label: "CPC", align: "right" },
                    { key: "cpa", label: "CPA", align: "right" },
                    { key: "conversions", label: "Orders", align: "right" },
                    { key: "adsRevenue", label: "Ads Revenue", align: "right" },
                    { key: "adsRoas", label: "Ads ROAS", align: "right" },
                    { key: "websiteRevenue", label: "Website Revenue", align: "right" },
                    { key: "websiteRoas", label: "Website ROAS", align: "right" },
                  ].map((col) => (
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
                  <td className="whitespace-nowrap px-4 py-2 text-ink-primary">Total ({sorted.length})</td>
                  <td className="px-4 py-2" colSpan={9} />
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(totals.spend)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(totals.impressions)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(totals.clicks)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(totals.ctr)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(totals.cvr)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(totals.cpc)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(totals.cpa)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(totals.conversions)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(totals.adsRevenue)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">
                    <RoasCell value={totals.adsRoas} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-muted">N/A</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-muted">N/A</td>
                </tr>
                {sorted.map((c) => (
                  <tr key={c.creativeKey} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                    <td className="max-w-[220px] truncate whitespace-nowrap px-4 py-2 font-mono text-[12px] font-medium text-ink-primary" title={creativeName(c)}>
                      {creativeName(c)}
                    </td>
                    <td className="max-w-[180px] truncate whitespace-nowrap px-4 py-2 text-ink-secondary" title={c.productTitle ?? c.sku}>
                      {c.productTitle ?? <SkuBadge sku={c.sku} />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-ink-secondary">{c.statusSummary}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <TagPill value={c.format} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <TagPill value={c.angle} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <TagPill value={c.style} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <TagPill value={c.gender} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(c.adCount)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(c.adSetCount)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(c.campaignCount)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(c.spend)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(c.impressions)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(c.clicks)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(c.ctr)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(c.cvr)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(c.cpc)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(c.cpa)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(c.conversions)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(c.adsRevenue)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">
                      <RoasCell value={c.adsRoas} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(c.websiteRevenue)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">
                      <RoasCell value={c.websiteRoas} />
                    </td>
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
