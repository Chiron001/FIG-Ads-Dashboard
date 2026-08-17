import { Fragment, useMemo, useState } from "react";
import type { ShopifyProductRow } from "@fig/shared";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { computeDelta } from "../lib/delta";
import { computeProductInsight, INSIGHT_META } from "../lib/productInsight";
import { InfoNote } from "./InfoNote";
import { ProductPerformanceDrawer } from "./ProductPerformanceDrawer";

interface TextColumn {
  key: "title" | "sku" | "productType";
  label: string;
  format: (r: ShopifyProductRow) => string;
}

const TEXT_COLUMNS: TextColumn[] = [
  { key: "title", label: "Product", format: (r) => r.title ?? r.productId },
  { key: "sku", label: "SKU", format: (r) => r.sku ?? "N/A" },
  { key: "productType", label: "Type", format: (r) => r.productType ?? "N/A" },
];

interface NumericColumn {
  key: keyof ShopifyProductRow;
  label: string;
  format: (v: number | null) => string;
}

// Financial metrics first (Revenue through POAS), then engagement metrics
// (Sessions through Bounce Rate), then the two platform session splits --
// same grouping logic as the KPI row above this table.
const NUMERIC_COLUMNS: NumericColumn[] = [
  { key: "unitsSold", label: "Units Sold", format: (v) => formatNumber(v) },
  { key: "orders", label: "Orders", format: (v) => formatNumber(v) },
  { key: "revenue", label: "Revenue", format: (v) => formatCurrency(v) },
  { key: "skuAttributedSpend", label: "SKU Attributed Spend", format: (v) => formatCurrency(v) },
  { key: "metaCatalogSpend", label: "Meta Catalog Spend", format: (v) => formatCurrency(v) },
  { key: "roas", label: "ROAS", format: (v) => formatMultiplier(v) },
  { key: "poas", label: "POAS", format: (v) => formatMultiplier(v) },
  { key: "sessions", label: "Sessions", format: (v) => formatNumber(v) },
  { key: "cvr", label: "CVR", format: (v) => formatPercent(v) },
  { key: "atc", label: "ATC", format: (v) => formatNumber(v) },
  { key: "bounceRate", label: "Bounce Rate", format: (v) => formatPercent(v) },
  { key: "googleSessions", label: "Google Sessions", format: (v) => formatNumber(v) },
  { key: "metaSessions", label: "Meta Sessions", format: (v) => formatNumber(v) },
];

interface Props {
  products: ShopifyProductRow[];
  /** Same product rows, fetched for the "Compare to" period -- null/absent
   * when no comparison is active. Matched by productId below. When active,
   * every numeric column expands into 3 sub-columns (this period / compare
   * period / % change) instead of one. */
  comparisonProducts?: ShopifyProductRow[] | null;
  comparisonLabel?: string;
  /** Same product rows, fetched for the immediately-adjacent previous
   * period specifically -- always fetched, independent of the "Compare to"
   * comparisonProducts above -- powers the "Performance" column's
   * always-on analysis. Null while loading. */
  previousPeriodProducts: ShopifyProductRow[] | null;
}

/** Standalone delta cell (not an inline suffix like DeltaBadge) -- "N/A"
 * when null rather than an unexplained blank cell, consistent with the
 * app's null-not-empty convention. */
function DeltaCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-muted">N/A</span>;
  if (value === 0) return <span className="text-ink-muted">·flat</span>;
  const up = value > 0;
  return (
    <span className={`tabular-nums ${up ? "text-status-good" : "text-status-critical"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {(value * 100).toFixed(1)}%
    </span>
  );
}

export function ShopifyProductTable({ products, comparisonProducts, comparisonLabel, previousPeriodProducts }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof ShopifyProductRow>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [performanceProductId, setPerformanceProductId] = useState<string | null>(null);

  const comparing = comparisonProducts != null;

  const comparisonByProductId = useMemo(() => {
    if (!comparisonProducts) return null;
    return new Map(comparisonProducts.map((p) => [p.productId, p]));
  }, [comparisonProducts]);

  const previousPeriodByProductId = useMemo(() => {
    if (!previousPeriodProducts) return null;
    return new Map(previousPeriodProducts.map((p) => [p.productId, p]));
  }, [previousPeriodProducts]);

  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? products.filter((p) => (p.title ?? "").toLowerCase().includes(term) || (p.sku ?? "").toLowerCase().includes(term))
      : products;

    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1; // nulls always last, regardless of direction
      if (bNull) return -1;
      const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [products, search, sortKey, sortDir]);

  function toggleSort(key: keyof ShopifyProductRow) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const performanceProduct = performanceProductId ? products.find((p) => p.productId === performanceProductId) : null;

  return (
    <div className="rounded-2xl border border-border bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-ink-primary">
            Products <span className="font-normal text-ink-muted">({sorted.length})</span>
          </h3>
          <InfoNote label="About these columns">
            SKU Attributed Spend is Meta spend from ads whose NAME carries this product's SKU tag -- a token can match
            more than one product's SKUs, in which case its spend is counted for each (directional, same caveat as
            Meta's own SKU Attribution page). Meta Catalog Spend is a different, exact-match Meta mechanism (dynamic
            catalog ads), matched by product handle -- the two are additive, not double-counting the same spend. ROAS
            = Revenue ÷ (SKU Attributed Spend + Meta Catalog Spend); POAS = Gross Profit ÷ that same combined spend,
            Gross Profit modeled at 65% of revenue (COGS assumed 35%). ATC is Shopify Analytics' sessions that added
            this product to cart; Bounce Rate is Shopify Analytics' own per-product figure, live. Performance always
            compares to the immediately-adjacent previous period (same length, right before this one) regardless of
            the top bar's "Compare to" setting -- click a badge for the full analytical breakdown.
          </InfoNote>
          {comparing && comparisonLabel && (
            <span className="text-xs text-ink-muted">
              · comparing to <span className="text-ink-secondary">{comparisonLabel.toLowerCase()}</span>
            </span>
          )}
        </div>
        <input
          type="text"
          placeholder="Search products or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
        />
      </div>

      {sorted.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-muted">No product sales in this date range.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {TEXT_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    rowSpan={comparing ? 2 : 1}
                    onClick={() => toggleSort(col.key)}
                    className={`${
                      col.key === "title" ? "sticky left-0 z-10 bg-surface-1" : ""
                    } cursor-pointer select-none whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary`}
                  >
                    {col.label}
                    {sortKey === col.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                ))}
                <th
                  rowSpan={comparing ? 2 : 1}
                  className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted"
                  title="Always compares to the immediately-adjacent previous period, regardless of the top bar's Compare to setting"
                >
                  Performance
                </th>
                {NUMERIC_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    colSpan={comparing ? 3 : 1}
                    onClick={() => toggleSort(col.key)}
                    className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary"
                  >
                    {col.label}
                    {sortKey === col.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                ))}
              </tr>
              {comparing && (
                <tr className="border-b border-border">
                  {NUMERIC_COLUMNS.map((col) => (
                    <Fragment key={col.key}>
                      <th className="whitespace-nowrap bg-surface-2/50 px-3 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-ink-muted">Now</th>
                      <th className="whitespace-nowrap bg-surface-2/50 px-3 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-ink-muted">Prior</th>
                      <th className="whitespace-nowrap bg-surface-2/50 px-3 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-ink-muted">Δ%</th>
                    </Fragment>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {sorted.map((row) => {
                const comp = comparisonByProductId?.get(row.productId) ?? null;
                const previousPeriodRow = previousPeriodByProductId?.get(row.productId) ?? null;
                const insight = previousPeriodByProductId ? computeProductInsight(row, previousPeriodRow) : null;
                const insightMeta = insight ? INSIGHT_META[insight.verdict] : null;
                return (
                  <tr key={row.productId} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                    {TEXT_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={`whitespace-nowrap px-4 py-2 text-left text-ink-primary ${
                          col.key === "title" ? "sticky left-0 z-10 max-w-xs truncate bg-surface-1 font-medium" : ""
                        }`}
                      >
                        {col.format(row)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-2">
                      {insight && insightMeta ? (
                        <button
                          type="button"
                          onClick={() => setPerformanceProductId(row.productId)}
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80"
                          style={{ background: `color-mix(in oklab, ${insightMeta.color} 16%, transparent)`, color: insightMeta.color }}
                          title="Click for the full analytical breakdown"
                        >
                          {insight.label}
                        </button>
                      ) : (
                        <span className="text-xs text-ink-muted">Loading…</span>
                      )}
                    </td>
                    {NUMERIC_COLUMNS.map((col) => {
                      const value = (row[col.key] as number | null) ?? null;
                      if (!comparing) {
                        return (
                          <td key={col.key} className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">
                            {col.format(value)}
                          </td>
                        );
                      }
                      const compValue = comp ? ((comp[col.key] as number | null) ?? null) : null;
                      const delta = computeDelta(value, compValue);
                      return (
                        <Fragment key={col.key}>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-primary">{col.format(value)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-muted">{col.format(compValue)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            <DeltaCell value={delta} />
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {performanceProduct && (
        <ProductPerformanceDrawer
          product={performanceProduct}
          previous={previousPeriodByProductId?.get(performanceProduct.productId) ?? null}
          onClose={() => setPerformanceProductId(null)}
        />
      )}
    </div>
  );
}
