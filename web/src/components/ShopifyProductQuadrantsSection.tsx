import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { ProductQuadrant, ProductQuadrantRow, ProductQuadrantsResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchShopifyProductQuadrants } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatMultiplier } from "../lib/format";
import { KpiTile } from "./KpiTile";
import { InfoNote } from "./InfoNote";
import { RankedBarChart } from "./RankedBarChart";

interface Props {
  range: DateRange;
  connected: boolean;
  refreshKey: number;
  targetRoas: number;
}

// Same four hues as the app's validated status palette (good/critical/info/
// warning) -- reused rather than invented so the quadrant colors are
// guaranteed CVD-safe without re-running the palette validator, and raw hex
// (not var(--color-status-*)) since Recharts fill/stroke props don't
// reliably resolve CSS custom properties across browsers.
const QUADRANT_COLORS: Record<ProductQuadrant, string> = {
  Q1: "#6ba5e5", // low spend, high sales -- opportunity (info blue)
  Q2: "#4ade80", // high spend, high sales -- star performers (good green)
  Q3: "#f26d6d", // high spend, low sales -- reassess (critical red)
  Q4: "#e5a94e", // low spend, low sales -- low priority (warning amber)
};

const QUADRANT_META: Record<ProductQuadrant, { title: string; subtitle: string }> = {
  Q1: { title: "Q1 — Low Spend, High Sales", subtitle: "Under-invested winners: scale opportunity" },
  Q2: { title: "Q2 — High Spend, High Sales", subtitle: "Star performers: protect and keep funding" },
  Q3: { title: "Q3 — High Spend, Low Sales", subtitle: "Spend not converting: reassess or cut" },
  Q4: { title: "Q4 — Low Spend, Low Sales", subtitle: "Low priority: neither spend nor sales are notable" },
};

const QUADRANT_ORDER: ProductQuadrant[] = ["Q1", "Q2", "Q3", "Q4"];

// COGS assumption is fixed server-side at 35% (spec: "consider COGS as 35%
// of Selling price") -- gross-profit rate is just its complement, used for
// this section's scenario projections.
const GROSS_PROFIT_RATE = 1 - 0.35;

// Spend increments for the risk-modeling scenario panel -- three round,
// analyst-legible checkpoints rather than a continuous slider.
const SCENARIO_INCREMENTS = [10_000, 25_000, 50_000];

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface QuadrantGroup {
  quadrant: ProductQuadrant;
  products: ProductQuadrantRow[];
  count: number;
  spend: number;
  revenue: number;
  grossProfit: number;
  poas: number | null;
}

function groupByQuadrant(products: ProductQuadrantRow[]): QuadrantGroup[] {
  return QUADRANT_ORDER.map((q) => {
    const rows = products.filter((p) => p.quadrant === q);
    const spend = rows.reduce((s, r) => s + r.adSpend, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const grossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
    return { quadrant: q, products: rows, count: rows.length, spend, revenue, grossProfit, poas: safeDivide(grossProfit, spend) };
  });
}

function CorrelationScatter({
  data,
  color,
  xLabel,
  yLabel,
}: {
  data: { x: number; y: number; title: string }[];
  color: string;
  xLabel: string;
  yLabel: string;
}) {
  if (data.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-ink-muted">Not enough matched products to plot.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--color-grid)" />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          tickFormatter={(v) => formatNumber(v, true)}
          stroke="var(--color-axis)"
          tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "var(--color-axis)" }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          tickFormatter={(v) => formatCurrency(v, true)}
          stroke="var(--color-axis)"
          tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-axis)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0]?.payload as { x: number; y: number; title: string } | undefined;
            if (!p) return null;
            return (
              <div className="glass rounded-md px-3 py-2 text-xs">
                <div className="max-w-[200px] truncate font-medium text-ink-primary">{p.title}</div>
                <div className="mt-1 tabular-nums text-ink-secondary">
                  {xLabel} {formatNumber(p.x)} · {yLabel} {formatCurrency(p.y)}
                </div>
              </div>
            );
          }}
        />
        <Scatter data={data} fill={color} fillOpacity={0.75} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ShopifyProductQuadrantsSection({ range, connected, refreshKey, targetRoas }: Props) {
  const [data, setData] = useState<ProductQuadrantsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [quadrantFilter, setQuadrantFilter] = useState<ProductQuadrant | "all">("all");
  const [sortKey, setSortKey] = useState<"adSpend" | "revenue" | "poas" | "cvr">("adSpend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchShopifyProductQuadrants(range.from, range.to)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(String(err.message ?? err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, connected, refreshKey]);

  const products = data?.products ?? [];
  const groups = useMemo(() => groupByQuadrant(products), [products]);

  const totalAdSpend = useMemo(() => products.reduce((s, p) => s + p.adSpend, 0), [products]);
  const totalRevenue = useMemo(() => products.reduce((s, p) => s + p.revenue, 0), [products]);
  const totalGrossProfit = useMemo(() => products.reduce((s, p) => s + p.grossProfit, 0), [products]);
  const blendedPoas = safeDivide(totalGrossProfit, totalAdSpend);
  const blendedRoas = safeDivide(totalRevenue, totalAdSpend);

  const scatterByQuadrant = useMemo(
    () =>
      QUADRANT_ORDER.map((q) => ({
        quadrant: q,
        points: products
          .filter((p) => p.quadrant === q)
          .map((p) => ({ productId: p.productId, title: p.title ?? p.productId, adSpend: p.adSpend, revenue: p.revenue, adImpressions: p.adImpressions, poas: p.poas })),
      })),
    [products]
  );

  const poasRankedItems = useMemo(
    () =>
      [...products]
        .filter((p) => p.adSpend > 0)
        .sort((a, b) => b.adSpend - a.adSpend)
        .slice(0, 10)
        .map((p) => ({ key: p.productId, label: p.title ?? p.productId, sublabel: p.sku ?? undefined, value: p.adSpend, roas: p.poas })),
    [products]
  );

  const sessionsCorrelationData = useMemo(
    () => products.filter((p) => p.sessions != null && p.revenue > 0).map((p) => ({ x: p.sessions as number, y: p.revenue, title: p.title ?? p.productId })),
    [products]
  );
  const marketingCorrelationData = useMemo(
    () =>
      products.filter((p) => p.marketingSessions != null && p.revenue > 0).map((p) => ({ x: p.marketingSessions as number, y: p.revenue, title: p.title ?? p.productId })),
    [products]
  );

  const scenarioRows = useMemo(() => {
    const reg = data?.spendRevenueRegression;
    if (!reg || reg.beta1 <= 0) return [];
    return SCENARIO_INCREMENTS.map((increment) => {
      const projectedRevenue = reg.beta1 * increment;
      const projectedGrossProfit = projectedRevenue * GROSS_PROFIT_RATE;
      const netAfterSpend = projectedGrossProfit - increment;
      return { increment, projectedRevenue, projectedGrossProfit, netAfterSpend };
    });
  }, [data]);

  const sortedTable = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = products;
    if (quadrantFilter !== "all") rows = rows.filter((p) => p.quadrant === quadrantFilter);
    if (term) rows = rows.filter((p) => (p.title ?? "").toLowerCase().includes(term) || (p.sku ?? "").toLowerCase().includes(term));
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [products, search, quadrantFilter, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-12 text-center">
        <div className="text-sm font-medium text-ink-primary">Shopify isn't connected yet</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Shopify credentials aren't configured (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">{error}</div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <InfoNote label="Methodology">
          Every Shopify product is classified into one of 4 quadrants by combined Google + Meta ad spend (x) vs.
          Shopify revenue (y), split at the cross-sectional MEDIAN across active products this period -- not an
          arbitrary fixed threshold. POAS (Profit on Ad Spend) = Gross Profit ÷ Ad Spend, where Gross Profit = Revenue
          × 65% (COGS modeled at 35% of selling price -- no real per-product cost data exists, so this is a modeled
          figure). Ad spend is decoded from each platform's product catalog ID and matched to the Shopify product,
          same join used by Products' Website ROAS.
        </InfoNote>
        Products classified by ad spend vs. sales, with a POAS/profitability lens
        {data && data.excludedInactiveCount > 0 && (
          <span> · {formatNumber(data.excludedInactiveCount)} product(s) excluded (no spend and no sales this period)</span>
        )}
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 ${loading ? "opacity-60" : ""}`}>
        <KpiTile label="Ad Spend" value={formatCurrency(totalAdSpend)} numeric={totalAdSpend} numericFormat="currency" staggerIndex={0} sublabel="Google + Meta, matched" />
        <KpiTile label="Revenue" value={formatCurrency(totalRevenue)} numeric={totalRevenue} numericFormat="currency" staggerIndex={1} />
        <KpiTile label="Gross Profit" value={formatCurrency(totalGrossProfit)} numeric={totalGrossProfit} numericFormat="currency" staggerIndex={2} sublabel="65% of revenue" />
        <KpiTile label="ROAS" value={formatMultiplier(blendedRoas)} staggerIndex={3} sublabel={`target ${formatMultiplier(targetRoas)}`} />
        <KpiTile label="POAS" value={formatMultiplier(blendedPoas)} staggerIndex={4} sublabel="profit ÷ ad spend, breakeven 1.00x" />
        <KpiTile label="Active Products" value={formatNumber(products.length)} numeric={products.length} numericFormat="number" staggerIndex={5} />
      </div>

      {/* Quadrant scatter -- the core view. Bubble size = ad impressions. */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-base text-ink-primary">Ad Spend vs. Sales — 4 Quadrants</h3>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-secondary">
            {QUADRANT_ORDER.map((q) => (
              <span key={q} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: QUADRANT_COLORS[q] }} />
                {QUADRANT_META[q].title}
              </span>
            ))}
          </div>
        </div>
        {products.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{data ? "No active products in this range." : "Loading…"}</div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--color-grid)" />
              <XAxis
                type="number"
                dataKey="adSpend"
                name="Ad Spend"
                tickFormatter={(v) => formatCurrency(v, true)}
                stroke="var(--color-axis)"
                tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-axis)" }}
              />
              <YAxis
                type="number"
                dataKey="revenue"
                name="Revenue"
                tickFormatter={(v) => formatCurrency(v, true)}
                stroke="var(--color-axis)"
                tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
              />
              <ZAxis type="number" dataKey="adImpressions" range={[36, 320]} name="Impressions" />
              <ReferenceLine x={data?.spendMedian ?? 0} stroke="var(--color-ink-muted)" strokeDasharray="4 3" />
              <ReferenceLine y={data?.revenueMedian ?? 0} stroke="var(--color-ink-muted)" strokeDasharray="4 3" />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0]?.payload as (typeof scatterByQuadrant)[number]["points"][number] | undefined;
                  if (!p) return null;
                  return (
                    <div className="glass rounded-md px-3 py-2 text-xs">
                      <div className="max-w-[220px] truncate font-medium text-ink-primary">{p.title}</div>
                      <div className="mt-1 space-y-0.5 tabular-nums text-ink-secondary">
                        <div>Spend {formatCurrency(p.adSpend)}</div>
                        <div>Revenue {formatCurrency(p.revenue)}</div>
                        <div>Impressions {formatNumber(p.adImpressions)}</div>
                        <div>POAS {formatMultiplier(p.poas)}</div>
                      </div>
                    </div>
                  );
                }}
              />
              {scatterByQuadrant.map(
                (g) => g.points.length > 0 && <Scatter key={g.quadrant} name={QUADRANT_META[g.quadrant].title} data={g.points} fill={QUADRANT_COLORS[g.quadrant]} fillOpacity={0.8} />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Quadrant summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((g) => (
          <div key={g.quadrant} className="rounded-2xl border border-border bg-surface-1 p-4" style={{ borderTopColor: QUADRANT_COLORS[g.quadrant], borderTopWidth: "3px" }}>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-primary">{QUADRANT_META[g.quadrant].title}</div>
            <p className="mt-0.5 text-[11px] text-ink-muted">{QUADRANT_META[g.quadrant].subtitle}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-ink-muted">Products</div>
                <div className="font-hero-num tabular-nums text-ink-primary">{formatNumber(g.count)}</div>
              </div>
              <div>
                <div className="text-ink-muted">POAS</div>
                <div className="font-hero-num tabular-nums text-ink-primary">{formatMultiplier(g.poas)}</div>
              </div>
              <div>
                <div className="text-ink-muted">Spend</div>
                <div className="tabular-nums text-ink-secondary">{formatCurrency(g.spend)}</div>
              </div>
              <div>
                <div className="text-ink-muted">Revenue</div>
                <div className="tabular-nums text-ink-secondary">{formatCurrency(g.revenue)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Half-width pair: POAS ranked bar + quadrant spend-share donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="mb-1 flex items-center gap-1.5">
            <h3 className="font-display text-base text-ink-primary">Top products by spend, colored by POAS</h3>
            <InfoNote label="How this chart works">
              Bar length is combined ad spend; color is POAS (Gross Profit ÷ Ad Spend) vs. a 1.00x breakeven -- red is
              below breakeven, green is comfortably profitable.
            </InfoNote>
          </div>
          <RankedBarChart
            items={poasRankedItems}
            targetRoas={1}
            valueFormatter={(v) => formatCurrency(v)}
            emptyMessage="No products with matched ad spend yet."
          />
        </div>

        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="mb-1 flex items-center gap-1.5">
            <h3 className="font-display text-base text-ink-primary">Ad spend share by quadrant</h3>
            <InfoNote label="How this chart works">
              How the combined ad spend budget is currently split across the 4 quadrants -- a large Q3 slice means a
              lot of spend is going to products that aren't converting.
            </InfoNote>
          </div>
          {totalAdSpend > 0 ? (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
              <ResponsiveContainer width="100%" height={280} className="sm:w-[46%]">
                <PieChart>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const p = payload[0]?.payload as QuadrantGroup | undefined;
                      if (!p) return null;
                      return (
                        <div className="glass rounded-md px-3 py-2 text-xs">
                          <div className="font-medium text-ink-primary">{QUADRANT_META[p.quadrant].title}</div>
                          <div className="mt-1 tabular-nums text-ink-secondary">
                            {formatCurrency(p.spend)} · {formatPercent(safeDivide(p.spend, totalAdSpend), 0)} of spend
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Pie
                    data={groups.filter((g) => g.spend > 0)}
                    dataKey="spend"
                    nameKey="quadrant"
                    innerRadius="58%"
                    outerRadius="95%"
                    paddingAngle={2}
                    isAnimationActive={false}
                    label={({ percent }) => ((percent ?? 0) >= 0.08 ? formatPercent(percent ?? 0, 0) : "")}
                    labelLine={false}
                  >
                    {groups
                      .filter((g) => g.spend > 0)
                      .map((g) => (
                        <Cell key={g.quadrant} fill={QUADRANT_COLORS[g.quadrant]} stroke="var(--color-surface-1)" strokeWidth={2} />
                      ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Richer than a plain %-share legend -- spend, revenue, and
                  POAS per quadrant, matching the level of detail the ranked-
                  bar panel on the left has, so this half of the pair doesn't
                  read as sparse next to it (confirmed live: the old 4-row
                  dot+percent legend left a lot of the taller card empty). */}
              <div className="w-full flex-1 divide-y divide-border self-center">
                {groups.map((g) => (
                  <div key={g.quadrant} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: QUADRANT_COLORS[g.quadrant] }} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-ink-primary">{QUADRANT_META[g.quadrant].title}</span>
                        <span className="block text-[11px] text-ink-muted">{formatNumber(g.count)} products</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs tabular-nums text-ink-primary">{formatCurrency(g.spend, true)}</span>
                      <span className="block text-[11px] tabular-nums text-ink-muted">
                        {g.poas != null ? `${formatMultiplier(g.poas)} POAS` : "N/A POAS"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-sm text-ink-muted">No matched ad spend yet.</div>
          )}
        </div>
      </div>

      {/* Half-width pair: sessions vs revenue correlation, marketing sessions vs revenue correlation */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-display text-base text-ink-primary">Sessions vs. Revenue</h3>
            {data?.sessionsVsRevenue && (
              <span className="text-xs tabular-nums text-ink-secondary">
                r = {data.sessionsVsRevenue.r.toFixed(2)} ({data.sessionsVsRevenue.strength}, n={data.sessionsVsRevenue.n})
              </span>
            )}
          </div>
          <p className="mb-2 text-[11px] text-ink-muted">
            Site-wide sessions (all sources) per product, Pearson correlation vs. revenue. Association, not causation.
          </p>
          {data?.sessionsVsRevenue ? (
            <CorrelationScatter data={sessionsCorrelationData} color="#9ba3af" xLabel="Sessions" yLabel="Revenue" />
          ) : (
            <div className="px-4 py-10 text-center text-sm text-ink-muted">Fewer than 10 matched products -- not enough to correlate.</div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-display text-base text-ink-primary">Marketing Sessions vs. Revenue</h3>
            {data?.marketingSessionsVsRevenue && (
              <span className="text-xs tabular-nums text-ink-secondary">
                r = {data.marketingSessionsVsRevenue.r.toFixed(2)} ({data.marketingSessionsVsRevenue.strength}, n={data.marketingSessionsVsRevenue.n})
              </span>
            )}
          </div>
          <p className="mb-2 text-[11px] text-ink-muted">
            Google + Meta sessions only (by utm_source), Pearson correlation vs. revenue -- isolates paid-traffic-driven
            sessions from the site-wide total at left.
          </p>
          {data?.marketingSessionsVsRevenue ? (
            <CorrelationScatter data={marketingCorrelationData} color="#e5a94e" xLabel="Mktg Sessions" yLabel="Revenue" />
          ) : (
            <div className="px-4 py-10 text-center text-sm text-ink-muted">Fewer than 10 matched products -- not enough to correlate.</div>
          )}
        </div>
      </div>

      {/* Risk modeling -- cross-sectional spend/revenue regression, scenario projections */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="mb-1 flex items-center gap-1.5">
          <h3 className="font-display text-base text-ink-primary">Risk modeling — incremental spend projection</h3>
          <InfoNote tone="warning" label="How to read this">
            A cross-sectional linear fit (revenue ~ ad spend, one point per product) across every active product this
            period -- NOT a time series, and NOT product-specific. It estimates the portfolio's average marginal
            revenue per extra rupee of spend. Treat directionally; a low r² means spend isn't the main driver of the
            spread in revenue across products.
          </InfoNote>
        </div>
        {data?.spendRevenueRegression ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-ink-muted">Marginal revenue / ₹1</div>
                <div className="font-hero-num tabular-nums text-ink-primary">₹{data.spendRevenueRegression.beta1.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Fit (r²)</div>
                <div className="font-hero-num tabular-nums text-ink-primary">{(data.spendRevenueRegression.r2 * 100).toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Products in fit</div>
                <div className="font-hero-num tabular-nums text-ink-primary">{formatNumber(data.spendRevenueRegression.n)}</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted">Breakeven marginal revenue</div>
                <div className="font-hero-num tabular-nums text-ink-primary">₹{(1 / GROSS_PROFIT_RATE).toFixed(2)}</div>
              </div>
            </div>
            {data.spendRevenueRegression.r2 < 0.3 && (
              <p className="mb-3 text-xs text-status-warning">
                r² is below 0.3 -- this fit is weak; ad spend explains little of the spread in revenue across products.
                Scenarios below are still shown, but treat them as illustrative, not a forecast.
              </p>
            )}
            {scenarioRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2 text-left">If spend increases by</th>
                      <th className="px-3 py-2 text-right">Projected + Revenue</th>
                      <th className="px-3 py-2 text-right">Projected + Gross Profit</th>
                      <th className="px-3 py-2 text-right">Net after spend</th>
                      <th className="px-3 py-2 text-left">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarioRows.map((r) => (
                      <tr key={r.increment} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 tabular-nums text-ink-primary">{formatCurrency(r.increment)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.projectedRevenue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(r.projectedGrossProfit)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.netAfterSpend >= 0 ? "text-status-good" : "text-status-critical"}`}>
                          {formatCurrency(r.netAfterSpend)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={r.netAfterSpend >= 0 ? "text-status-good" : "text-status-critical"}>
                            {r.netAfterSpend >= 0 ? "Profitable" : "Unprofitable"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                The fitted slope is flat or negative this period -- no positive marginal-revenue projection to show.
              </p>
            )}
          </>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">Not enough active products this period to fit a regression.</div>
        )}
      </div>

      {/* Full product table */}
      <div className="rounded-2xl border border-border bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-primary">
            Products <span className="font-normal text-ink-muted">({sortedTable.length})</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setQuadrantFilter("all")}
                className={`rounded px-2.5 py-1 transition-colors ${quadrantFilter === "all" ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"}`}
              >
                All
              </button>
              {QUADRANT_ORDER.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuadrantFilter(q)}
                  className={`rounded px-2.5 py-1 transition-colors ${quadrantFilter === q ? "bg-surface-2 text-ink-primary" : "text-ink-muted hover:text-ink-secondary"}`}
                >
                  {q}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search products or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
            />
          </div>
        </div>

        {sortedTable.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{data ? "Nothing matches the current filters." : "Loading…"}</div>
        ) : (
          <div className="table-scroll-pane">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky-thead whitespace-nowrap bg-surface-1 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Product</th>
                  <th className="sticky-thead whitespace-nowrap bg-surface-1 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">Quadrant</th>
                  <th
                    onClick={() => toggleSort("adSpend")}
                    className="sticky-thead cursor-pointer select-none whitespace-nowrap bg-surface-1 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary"
                  >
                    Ad Spend {sortKey === "adSpend" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="sticky-thead whitespace-nowrap bg-surface-1 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Impressions</th>
                  <th
                    onClick={() => toggleSort("revenue")}
                    className="sticky-thead cursor-pointer select-none whitespace-nowrap bg-surface-1 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary"
                  >
                    Revenue {sortKey === "revenue" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="sticky-thead whitespace-nowrap bg-surface-1 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Gross Profit</th>
                  <th
                    onClick={() => toggleSort("poas")}
                    className="sticky-thead cursor-pointer select-none whitespace-nowrap bg-surface-1 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary"
                  >
                    POAS {sortKey === "poas" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="sticky-thead whitespace-nowrap bg-surface-1 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">ROAS</th>
                  <th
                    onClick={() => toggleSort("cvr")}
                    className="sticky-thead cursor-pointer select-none whitespace-nowrap bg-surface-1 px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted hover:text-ink-secondary"
                  >
                    CVR {sortKey === "cvr" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTable.map((row) => (
                  <tr key={row.productId} className="border-b border-border last:border-0 transition-colors hover:bg-accent-soft">
                    <td className="max-w-[220px] truncate whitespace-nowrap px-4 py-2 font-medium text-ink-primary">{row.title ?? row.productId}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {row.quadrant ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: `color-mix(in oklab, ${QUADRANT_COLORS[row.quadrant]} 18%, transparent)`, color: QUADRANT_COLORS[row.quadrant] }}
                        >
                          {row.quadrant}
                        </span>
                      ) : (
                        <span className="text-ink-muted">N/A</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(row.adSpend)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatNumber(row.adImpressions)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(row.revenue)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(row.grossProfit)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatMultiplier(row.poas)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatMultiplier(row.roas)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-secondary">{formatPercent(row.cvr)}</td>
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
