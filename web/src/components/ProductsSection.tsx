import { useEffect, useMemo, useState } from "react";
import type { CampaignRow, ProductGroupBy, GrainPlatform, MetricsProductsResponse, MetricsProductsParetoResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchProducts, fetchProductsPareto } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";

interface Props {
  platform: GrainPlatform;
  range: DateRange;
  grossMargin: number;
  campaigns: CampaignRow[];
  refreshKey: number;
}

interface EnrichedProductRow {
  key: string;
  label: string;
  skuCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cvr: number | null;
  cpc: number | null;
  cpa: number | null;
  conversions: number;
  aov: number | null;
  revenue: number;
  roas: number | null;
  acos: number | null;
  profit: number;
  pctOfSpend: number | null;
  pctOfRevenue: number | null;
}

const GOOGLE_GROUP_BY_OPTIONS: { value: ProductGroupBy; label: string }[] = [
  { value: "type_l1", label: "Category" },
  { value: "type_l2", label: "Sub-category" },
  { value: "sku", label: "SKU" },
];

// Meta's product_id breakdown has no category dimension (see
// server/src/etl/grainTypes.ts) -- category/sub-category grouping would
// just fold every product into one "—" row, so Meta only offers SKU.
const META_GROUP_BY_OPTIONS: { value: ProductGroupBy; label: string }[] = [{ value: "sku", label: "SKU" }];

function signClass(value: number): string {
  if (value > 0) return "text-status-good";
  if (value < 0) return "text-status-critical";
  return "";
}

function productLabel(row: MetricsProductsResponse["products"][number]): string {
  if (row.productTitle) return row.productTitle;
  if (row.productTypeL1 && row.productTypeL2) return `${row.productTypeL1} — ${row.productTypeL2}`;
  return row.productTypeL1 ?? row.key ?? "—";
}

export function ProductsSection({ platform, range, grossMargin, campaigns, refreshKey }: Props) {
  const groupByOptions = platform === "google" ? GOOGLE_GROUP_BY_OPTIONS : META_GROUP_BY_OPTIONS;
  // spec §1f: default to the L1 roll-up -- only meaningful on Google, so
  // Meta defaults straight to SKU (its only option).
  const [groupBy, setGroupBy] = useState<ProductGroupBy>(platform === "google" ? "type_l1" : "sku");
  const [campaignId, setCampaignId] = useState<string>("");
  const [data, setData] = useState<MetricsProductsResponse | null>(null);
  const [pareto, setPareto] = useState<MetricsProductsParetoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTailLeaks, setShowTailLeaks] = useState(false);
  const [hideZeroSpend, setHideZeroSpend] = useState(true); // same default as the campaign table / Ads section

  // Switching platform (tab change) resets to that platform's default
  // grouping -- a stale "type_l1" carried over from Google would silently
  // collapse every Meta product into one "—" row.
  useEffect(() => {
    setGroupBy(platform === "google" ? "type_l1" : "sku");
    setCampaignId("");
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchProducts(platform, range.from, range.to, groupBy, campaignId || null),
      fetchProductsPareto(platform, range.from, range.to, campaignId || null),
    ])
      .then(([productsRes, paretoRes]) => {
        if (cancelled) return;
        setData(productsRes);
        setPareto(paretoRes);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [platform, range.from, range.to, groupBy, campaignId, refreshKey]);

  const enriched = useMemo((): EnrichedProductRow[] => {
    if (!data) return [];
    const visible = data.products.filter((p) => !hideZeroSpend || p.spend > 0);
    const totalSpend = visible.reduce((s, p) => s + p.spend, 0);
    const totalRevenue = visible.reduce((s, p) => s + p.revenue, 0);
    return visible
      .map((p) => ({
        key: p.key,
        label: productLabel(p),
        skuCount: p.skuCount,
        spend: p.spend,
        impressions: p.impressions,
        clicks: p.clicks,
        ctr: p.ctr,
        cvr: p.cvr,
        cpc: p.cpc,
        cpa: p.cpa,
        conversions: p.conversions,
        aov: p.aov,
        revenue: p.revenue,
        roas: p.roas,
        acos: p.acos,
        profit: p.revenue * grossMargin - p.spend,
        pctOfSpend: totalSpend > 0 ? p.spend / totalSpend : null,
        pctOfRevenue: totalRevenue > 0 ? p.revenue / totalRevenue : null,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [data, grossMargin, hideZeroSpend]);

  const platformCampaigns = campaigns; // caller already scopes this to the current platform

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
            {platformCampaigns.map((c) => (
              <option key={c.campaignId} value={c.campaignId}>
                {c.campaignName ?? c.campaignId}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {groupByOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGroupBy(opt.value)}
                className={`rounded px-2 py-1 transition-colors ${
                  groupBy === opt.value ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
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

      {/* Mandatory attribution caveat -- spec §1d, not optional. */}
      <div className="mx-4 mt-3 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-ink-secondary">
        <span className="font-medium text-status-warning">Directional, not exact: </span>
        {platform === "google"
          ? "Revenue/orders here are attributed to the clicked product, not necessarily the one purchased -- a shopper who clicks a table lamp ad and buys a floor lamp is credited to the table lamp."
          : "Revenue/orders here are attributed to the product shown in the clicked/viewed ad (via catalog/pixel matching), not necessarily the one purchased."}{" "}
        Spend, impressions, and clicks are exact; ROAS per product is directional.
      </div>

      {data && (
        <div className="mx-4 mt-2 text-xs text-ink-muted">
          {data.reconciliation.deviationPct == null ? (
            "No campaign spend in this range to reconcile against."
          ) : data.reconciliation.withinTolerance ? (
            <>
              Reconciles to campaign spend within tolerance ({formatPercent(data.reconciliation.deviationPct, 1)} of{" "}
              {formatCurrency(data.reconciliation.campaignSpend)}).
            </>
          ) : (
            <>
              <span className="text-status-warning">⚠ Partial coverage:</span> this breakdown covers{" "}
              {formatCurrency(data.reconciliation.grainSpend)} of {formatCurrency(data.reconciliation.campaignSpend)} campaign spend (
              {formatPercent(1 - data.reconciliation.deviationPct, 0)} attributed) -- the rest has no product-level breakdown
              {platform === "google" ? " (Search/Display spend, or Shopping spend Google didn't tie to an item)" : " (no catalog/pixel product match)"}.
            </>
          )}
        </div>
      )}

      {pareto && pareto.totalSkus > 0 && (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-0 px-3 py-2 text-xs">
          <span className="text-ink-secondary">
            <span className="font-semibold text-ink-primary">{pareto.skusToEightyPercent}</span> of {pareto.totalSkus} SKUs drive 80% of
            product-attributed revenue.
          </span>
          {pareto.tailLeaks.length > 0 && (
            <button type="button" onClick={() => setShowTailLeaks((v) => !v)} className="text-status-warning hover:underline">
              {pareto.tailLeaks.length} spend leak{pareto.tailLeaks.length === 1 ? "" : "s"} (spend, zero orders) {showTailLeaks ? "▲" : "▼"}
            </button>
          )}
        </div>
      )}
      {showTailLeaks && pareto && pareto.tailLeaks.length > 0 && (
        <div className="mx-4 mt-2 max-h-40 overflow-y-auto rounded-md border border-status-warning/30 bg-status-warning/5">
          {pareto.tailLeaks.map((t) => (
            <div key={t.productItemId} className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs last:border-0">
              <span className="max-w-xs truncate text-ink-secondary">{t.productTitle ?? t.productItemId}</span>
              <span className="text-status-warning tabular-nums">{formatCurrency(t.spend)}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`mt-3 overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        {enriched.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">
            {data && data.products.length > 0 ? "No products match the current filters." : "No product data for this range yet."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {groupBy === "sku" ? "Product" : groupBy === "type_l2" ? "Sub-category" : "Category"}
                </th>
                {groupBy !== "sku" && (
                  <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">SKUs</th>
                )}
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Spend</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">% Spend</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Impr.</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Clicks</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CTR</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CVR</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">CPA</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Orders</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">AOV</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Revenue</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">% Rev</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">ROAS</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">ACOS</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Profit</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                  <td className="max-w-xs truncate px-4 py-2 font-medium text-ink-primary" title={r.label}>
                    {r.label}
                  </td>
                  {groupBy !== "sku" && <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(r.skuCount)}</td>}
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.spend)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.pctOfSpend, 1)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(r.impressions)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(r.clicks)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.ctr)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.cvr)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.cpa)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(r.conversions)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.aov)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.revenue)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.pctOfRevenue, 1)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatMultiplier(r.roas)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(r.acos)}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${signClass(r.profit)}`}>{formatCurrency(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
