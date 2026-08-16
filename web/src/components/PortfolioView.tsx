import { useEffect, useMemo, useState } from "react";
import type { Platform, PortfolioResponse, MetricsProductsResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchPortfolio, fetchProducts } from "../lib/api";
import { formatCurrency, formatPercent } from "../lib/format";
import { ParetoChart } from "./ParetoChart";
import { RankedBarChart } from "./RankedBarChart";

interface Props {
  platform: Platform;
  range: DateRange;
  grossMargin: number;
  targetRoas: number;
  color: string;
  refreshKey: number;
}

/** Real spend is lumpy day to day -- "spend has happened more than ₹100 in
 * a day" is read as an average-daily-spend floor (total spend over the
 * range ÷ days in range), the only version of that rule the already-
 * fetched, range-aggregated product data can answer without a new
 * per-day-per-product endpoint. */
function daysInRange(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1);
}

export function PortfolioView({ platform, range, grossMargin, targetRoas, color, refreshKey }: Props) {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [products, setProducts] = useState<MetricsProductsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPortfolio(platform, range.from, range.to, grossMargin),
      // Meta only -- Google's own product breakdown is already the
      // "Products" section right below this one; pairing it here too
      // would just repeat that view, not add a new lens.
      platform === "meta" ? fetchProducts("meta", range.from, range.to, "sku") : Promise.resolve(null),
    ])
      .then(([portfolioRes, productsRes]) => {
        if (cancelled) return;
        setData(portfolioRes);
        setProducts(productsRes);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [platform, range.from, range.to, grossMargin, refreshKey]);

  const days = daysInRange(range.from, range.to);
  const catalogueSpendItems = useMemo(() => {
    if (!products) return [];
    // productItemId's shape varies per catalog entry (a storefront URL for
    // some products, a raw numeric catalog id for others -- confirmed live)
    // -- not something worth surfacing as a label either way, so this chart
    // shows just the product name + spend + ROAS color, nothing else.
    return products.products
      .filter((p) => p.spend / days > 100)
      .map((p) => ({ key: p.key, label: p.productTitle ?? p.key, value: p.spend, roas: p.websiteRoas ?? p.roas }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [products, days]);

  if (loading && !data) {
    return <div className="rounded-2xl border border-border bg-surface-1 px-4 py-8 text-center text-sm text-ink-muted">Loading portfolio…</div>;
  }
  if (!data || data.totalCampaigns === 0) {
    return <div className="rounded-2xl border border-border bg-surface-1 px-4 py-8 text-center text-sm text-ink-muted">No campaign data in this range.</div>;
  }

  const paretoItems = data.pareto.map((p) => ({ key: p.campaignId, label: p.campaignName ?? p.campaignId, value: p.revenue }));
  const showCatalogueSpend = platform === "meta";

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 gap-4 ${showCatalogueSpend ? "lg:grid-cols-2" : ""}`}>
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink-primary">Revenue concentration (Pareto)</h3>
          <ParetoChart items={paretoItems} color={color} unitLabel="campaigns" valueFormatter={(v) => formatCurrency(v, true)} />
        </div>

        {showCatalogueSpend && (
          <div className="rounded-2xl border border-border bg-surface-1 p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-ink-primary">Product-wise catalogue spend</h3>
              <span className="text-xs text-ink-muted">avg. spend {'>'} ₹100/day, colored by ROAS</span>
            </div>
            <div className="max-h-[240px] overflow-y-auto pr-1">
              <RankedBarChart
                items={catalogueSpendItems}
                targetRoas={targetRoas}
                valueFormatter={(v) => formatCurrency(v, true)}
                emptyMessage="No product cleared ₹100/day average spend in this range."
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface-1">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-primary">Profit contribution ranking</h3>
          <p className="mt-0.5 text-xs text-ink-muted">Ranked by absolute profit (revenue × margin − spend), not ROAS.</p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-1">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Campaign</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Contribution</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {data.contribution.map((c) => (
                <tr key={c.campaignId} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                  <td className="max-w-xs truncate px-4 py-2 font-medium text-ink-primary">{c.campaignName ?? c.campaignId}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${c.contribution > 0 ? "text-status-good" : c.contribution < 0 ? "text-status-critical" : "text-ink-secondary"}`}>
                    {formatCurrency(c.contribution)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(c.pctOfTotal, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
