import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { runShopifySync } from "../etl/shopifySync";
import { ShopifyConnector } from "../connectors/shopify";
import { fetchGA4ProductSessionsByPlatform } from "../connectors/ga4";
import { env } from "../config/env";
import { median, pearsonCorrelation, linearRegression } from "../stats";
import { getCogsRate } from "../db/appSettings";
import type {
  ShopifyOrderSummary,
  ShopifySummaryResponse,
  ShopifyProductRow,
  ShopifyProductsResponse,
  ShopifyStatus,
  SyncLogEntry,
  ProductQuadrant,
  ProductQuadrantRow,
  ProductQuadrantsResponse,
  ShopifyTimeseriesPoint,
  ShopifyTimeseriesResponse,
} from "@fig/shared";

function safeDivide(n: number, d: number | null): number | null {
  return d != null && d > 0 ? n / d : null;
}

/** Live session totals (Shopify Analytics, via ShopifyQL) are a nice-to-have
 * on top of the ground-truth order data this route otherwise serves entirely
 * from Postgres -- if the ShopifyQL call fails for any reason (a plan/
 * permission restriction, a transient API issue), the rest of the response
 * still renders; sessions/cvr alone drop to null ("—" in the UI). */
async function fetchTotalSessionsSafe(from: string, to: string): Promise<number | null> {
  try {
    const connector = new ShopifyConnector();
    return await connector.fetchTotalSessions(from, to);
  } catch (err) {
    console.warn("[shopify] fetchTotalSessions failed, returning null:", err);
    return null;
  }
}

async function fetchProductSessionsSafe(from: string, to: string): Promise<Map<string, number>> {
  try {
    const connector = new ShopifyConnector();
    return await connector.fetchProductSessions(from, to);
  } catch (err) {
    console.warn("[shopify] fetchProductSessions failed, returning empty map:", err);
    return new Map();
  }
}

/** GA4's own channel classification (real browser-side event data), not a
 * regex guess against whatever a campaign happened to tag utm_source with --
 * see connectors/ga4.ts's header comment on fetchGA4ProductSessionsByPlatform
 * for why "Paid Search"/"Paid Social" map to Google/Meta specifically.
 * Site-wide total is a stored-data query (fact_ga4_channel_daily), not a
 * live API call -- fast, and consistent with the daily-synced history GA4
 * already has. Distinguishes "GA4 has no data for this range at all" (null,
 * both platforms) from "GA4 has data but zero sessions for that channel"
 * (a real 0), same null-means-unavailable contract fetchTotalSessionsSafe
 * already uses. */
async function fetchTotalSessionsByPlatformSafe(from: string, to: string): Promise<{ google: number | null; meta: number | null }> {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `select channel_group, coalesce(sum(sessions), 0)::float8 as sessions
       from fact_ga4_channel_daily
       where date between $1 and $2 and channel_group in ('Paid Search', 'Paid Social')
       group by channel_group`,
      [from, to]
    );
    if (rows.length === 0) return { google: null, meta: null };
    const byChannel = new Map(rows.map((r) => [r.channel_group as string, r.sessions as number]));
    return { google: byChannel.get("Paid Search") ?? 0, meta: byChannel.get("Paid Social") ?? 0 };
  } catch (err) {
    console.warn("[shopify] fetchTotalSessionsByPlatform (GA4) failed, returning null:", err);
    return { google: null, meta: null };
  }
}

async function fetchProductSessionsByPlatformSafe(
  from: string,
  to: string
): Promise<{ google: Map<string, number>; meta: Map<string, number> }> {
  try {
    return await fetchGA4ProductSessionsByPlatform(from, to);
  } catch (err) {
    console.warn("[shopify] fetchProductSessionsByPlatform (GA4) failed, returning empty maps:", err);
    return { google: new Map(), meta: new Map() };
  }
}

async function fetchProductEngagementSafe(from: string, to: string): Promise<Map<string, { atc: number; bounceRate: number | null }>> {
  try {
    const connector = new ShopifyConnector();
    return await connector.fetchProductEngagement(from, to);
  } catch (err) {
    console.warn("[shopify] fetchProductEngagement failed, returning empty map:", err);
    return new Map();
  }
}

// Same token as metaSkuAttribution.ts's SKU_TOKEN_PATTERN/extractSkuToken --
// duplicated (both private to their own route file) rather than imported,
// same convention as the product-item-ID patterns below.
const SKU_TOKEN_PATTERN = /FIG-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/i;

function extractSkuToken(adName: string | null): string | null {
  if (!adName) return null;
  const match = adName.match(SKU_TOKEN_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

export interface TokenMetric {
  spend: number;
  impressions: number;
}

/** Meta ad spend/impressions summed per SKU-tag token extracted from the
 * ad's name -- the same "true" per-token spend metaSkuAttribution.ts's
 * skuGroups uses, recomputed here (not imported -- that route returns its
 * full drill-down shape, more than this needs) so this file can match it
 * against Shopify products below.
 *
 * Excludes any ad belonging to a campaign that ALSO has catalog-level
 * product spend for the same range (fact_shopping_product_performance).
 * fact_ad_creative_performance (ad-level) and fact_shopping_product_
 * performance (catalog/product-level, breakdowns=product_id) are two
 * different BREAKDOWNS of the same underlying campaign spend, never meant
 * to be summed (db/migrations/0005's header) -- without this exclusion, a
 * catalog/dynamic-product ad that happens to also carry a "FIG-..." tag in
 * its name would be counted once here (via the name tag) and again via
 * metaCatalogSpend (via the catalog match), double-counting real spend.
 * Confirmed live this isn't hypothetical -- this account runs catalog
 * campaigns whose ad names also match the SKU pattern. Campaign-level, not
 * ad-level, because fact_shopping_product_performance has no ad_id column
 * (it's a campaign+product-item grain) -- campaign is the finest boundary
 * the data allows, and matches Meta's own catalog/Advantage+ ad sets being
 * a campaign-scoped setup in practice. */
async function fetchSkuAttributedMetricsByToken(from: string, to: string): Promise<Map<string, TokenMetric>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select acp.ad_id, max(acp.ad_name) as ad_name,
            coalesce(sum(acp.spend), 0)::float8 as spend,
            coalesce(sum(acp.impressions), 0)::float8 as impressions
     from fact_ad_creative_performance acp
     where acp.date between $1 and $2 and acp.platform::text = 'meta'
       and not exists (
         select 1 from fact_shopping_product_performance spp
         where spp.platform::text = 'meta'
           and spp.campaign_id = acp.campaign_id
           and spp.date between $1 and $2
       )
     group by acp.ad_id`,
    [from, to]
  );
  const byToken = new Map<string, TokenMetric>();
  for (const r of rows) {
    const token = extractSkuToken(r.ad_name);
    if (!token) continue;
    const cur = byToken.get(token) ?? { spend: 0, impressions: 0 };
    byToken.set(token, { spend: cur.spend + r.spend, impressions: cur.impressions + r.impressions });
  }
  return byToken;
}

/** A token is a prefix of the real SKU it was extracted from (see
 * extractSkuToken), and can therefore prefix-match more than one Shopify
 * product's SKUs -- when it does, this attributes the token's full spend to
 * EVERY matching product, same "directional, not exact" caveat already
 * shown on Meta's own SKU Attribution page for the identical reason (one
 * ad's spend counted once per SKU it's tagged for, not split). */
function skuAttributedMetricsForProduct(skus: string[], tokenMetrics: Map<string, TokenMetric>): TokenMetric {
  let spend = 0;
  let impressions = 0;
  for (const [token, metric] of tokenMetrics) {
    if (skus.some((sku) => sku.startsWith(token))) {
      spend += metric.spend;
      impressions += metric.impressions;
    }
  }
  return { spend, impressions };
}

export const shopifyRouter = Router();

function parseDateRange(query: Record<string, unknown>): { from: string; to: string } | null {
  const from = typeof query.from === "string" ? query.from : null;
  const to = typeof query.to === "string" ? query.to : null;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// GET /shopify/status
shopifyRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `select id::text as id, status, rows, error, run_at as "runAt"
       from sync_log
       where platform = 'shopify'
       order by run_at desc
       limit 1`
    );
    const row = rows[0];
    const lastSync: SyncLogEntry | null = row
      ? {
          id: row.id,
          platform: "shopify",
          runAt: row.runAt instanceof Date ? row.runAt.toISOString() : row.runAt,
          status: row.status,
          rows: row.rows,
          error: row.error,
        }
      : null;

    const body: ShopifyStatus = {
      connected: Boolean(env.shopify.storeDomain && env.shopify.adminAccessToken),
      lastSync,
    };
    res.json(body);
  })
);

// POST /shopify/sync -- body: { from?, to? } (YYYY-MM-DD), defaults to last 7 days.
shopifyRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
    const from = typeof body.from === "string" ? body.from : isoDaysAgo(7);
    const to = typeof body.to === "string" ? body.to : isoDaysAgo(0);
    const result = await runShopifySync(from, to);
    res.status(result.status === "success" ? 200 : 502).json(result);
  })
);

// GET /shopify/summary?from&to
shopifyRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const [{ rows: orderRows }, { rows: lineItemRows }, sessions, sessionsByPlatform] = await Promise.all([
      pool.query(
        `select count(*)::float8 as orders,
                coalesce(sum(total_price), 0)::float8 as revenue,
                coalesce(sum(total_discounts), 0)::float8 as discounts
         from fact_shopify_orders
         where date between $1 and $2`,
        [range.from, range.to]
      ),
      pool.query(
        `select coalesce(sum(quantity), 0)::float8 as units_sold
         from fact_shopify_line_items
         where date between $1 and $2`,
        [range.from, range.to]
      ),
      fetchTotalSessionsSafe(range.from, range.to),
      fetchTotalSessionsByPlatformSafe(range.from, range.to),
    ]);
    const orderRow = orderRows[0];
    const unitsSold = lineItemRows[0].units_sold;

    const summary: ShopifyOrderSummary = {
      orders: orderRow.orders,
      revenue: orderRow.revenue,
      aov: orderRow.orders > 0 ? orderRow.revenue / orderRow.orders : null,
      discounts: orderRow.discounts,
      unitsSold,
      sessions,
      cvr: safeDivide(unitsSold, sessions),
      googleSessions: sessionsByPlatform.google,
      metaSessions: sessionsByPlatform.meta,
    };

    const response: ShopifySummaryResponse = { from: range.from, to: range.to, summary };
    res.json(response);
  })
);

// GET /shopify/timeseries?from&to -- daily points for this page's own
// "metric over time" chart. Blended Google+Meta spend/ROAS/ACOS is the one
// deliberate blending spot here (matches the KPI tiles above it on this
// page); sessions/CVR come from GA4's stored daily channel data
// (fact_ga4_channel_daily), not Shopify's own live-only ShopifyQL sessions,
// which have no daily history to chart (see db/migrations/0007's header).
shopifyRouter.get(
  "/timeseries",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const [{ rows: orderRows }, { rows: spendRows }, { rows: sessionRows }] = await Promise.all([
      pool.query(
        `select date::text as date, count(*)::float8 as orders,
                coalesce(sum(total_price), 0)::float8 as revenue,
                coalesce(sum(total_discounts), 0)::float8 as discounts
         from fact_shopify_orders
         where date between $1 and $2
         group by date`,
        [range.from, range.to]
      ),
      pool.query(
        `select date::text as date, coalesce(sum(spend), 0)::float8 as spend
         from fact_ad_performance
         where date between $1 and $2 and platform::text in ('google', 'meta')
         group by date`,
        [range.from, range.to]
      ),
      pool.query(
        `select date::text as date, coalesce(sum(sessions), 0)::float8 as sessions
         from fact_ga4_channel_daily
         where date between $1 and $2
         group by date`,
        [range.from, range.to]
      ),
    ]);

    const spendByDate = new Map(spendRows.map((r) => [r.date, r.spend as number]));
    const sessionsByDate = new Map(sessionRows.map((r) => [r.date, r.sessions as number]));

    const points: ShopifyTimeseriesPoint[] = orderRows
      .map((r) => {
        const revenue = r.revenue as number;
        const orders = r.orders as number;
        const spend = spendByDate.get(r.date) ?? 0;
        const sessions = sessionsByDate.has(r.date) ? sessionsByDate.get(r.date)! : null;
        return {
          date: r.date,
          revenue,
          orders,
          aov: safeDivide(revenue, orders),
          discounts: r.discounts as number,
          spend,
          roas: safeDivide(revenue, spend),
          acos: revenue > 0 ? safeDivide(spend, revenue) : null,
          sessions,
          cvr: sessions != null ? safeDivide(orders, sessions) : null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const response: ShopifyTimeseriesResponse = { from: range.from, to: range.to, points };
    res.json(response);
  })
);

// GET /shopify/products?from&to
shopifyRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const [{ rows }, sessionsByHandle, sessionsByHandleByPlatform, adMetrics, skuTokenMetrics, engagementByHandle, cogsRate] = await Promise.all([
      pool.query(
        `select
           product_id,
           max(product_handle) as product_handle,
           max(sku) as sku,
           array_agg(distinct upper(sku)) filter (where sku is not null) as skus,
           max(title) as title,
           max(product_type) as product_type,
           max(vendor) as vendor,
           sum(quantity)::float8 as units_sold,
           sum(line_total)::float8 as revenue,
           count(distinct order_id)::float8 as orders
         from fact_shopify_line_items
         where date between $1 and $2
         group by product_id
         order by revenue desc`,
        [range.from, range.to]
      ),
      fetchProductSessionsSafe(range.from, range.to),
      fetchProductSessionsByPlatformSafe(range.from, range.to),
      fetchAdMetricsByProductKeys(range.from, range.to),
      fetchSkuAttributedMetricsByToken(range.from, range.to),
      fetchProductEngagementSafe(range.from, range.to),
      getCogsRate(),
    ]);

    const products: ShopifyProductRow[] = rows.map((r) => {
      const sessions = r.product_handle ? (sessionsByHandle.get(r.product_handle) ?? null) : null;
      const googleSessions = r.product_handle ? (sessionsByHandleByPlatform.google.get(r.product_handle) ?? null) : null;
      const metaSessions = r.product_handle ? (sessionsByHandleByPlatform.meta.get(r.product_handle) ?? null) : null;

      const skus: string[] = r.skus ?? [];
      const skuAttributedSpend = skuAttributedMetricsForProduct(skus, skuTokenMetrics).spend;
      const metaCatalogSpend = r.product_handle ? (adMetrics.metaByHandle.get(r.product_handle)?.spend ?? 0) : 0;
      const googleSpend = r.product_id ? (adMetrics.googleByProductGid.get(r.product_id)?.spend ?? 0) : 0;
      const adSpend = skuAttributedSpend + metaCatalogSpend + googleSpend;
      const grossProfit = r.revenue * (1 - cogsRate);

      const engagement = r.product_handle ? engagementByHandle.get(r.product_handle) : undefined;

      return {
        productId: r.product_id ?? "unknown",
        productHandle: r.product_handle,
        sku: r.sku,
        title: r.title,
        productType: r.product_type,
        vendor: r.vendor,
        unitsSold: r.units_sold,
        revenue: r.revenue,
        orders: r.orders,
        sessions,
        cvr: safeDivide(r.units_sold, sessions),
        googleSessions,
        metaSessions,
        skuAttributedSpend,
        metaCatalogSpend,
        googleSpend,
        adSpend,
        roas: adSpend > 0 ? r.revenue / adSpend : null,
        poas: adSpend > 0 ? grossProfit / adSpend : null,
        atc: engagement?.atc ?? null,
        bounceRate: engagement?.bounceRate ?? null,
      };
    });

    const response: ShopifyProductsResponse = { from: range.from, to: range.to, products };
    res.json(response);
  })
);

// --- Product Quadrants -------------------------------------------------
//
// Same decoding used for Products' Website ROAS join (see
// server/src/routes/metrics.ts's META_PRODUCT_ITEM_PATTERN/
// GOOGLE_PRODUCT_ITEM_PATTERN, private there so duplicated here rather than
// imported) but aggregated at the PRODUCT level, not variant: Meta's
// "/products/{handle}#product" already is product-level; Google's
// "shopify_zz_{productId}_{variantId}" is collapsed by dropping the variant
// half and keying straight off "gid://shopify/Product/{productId}", which
// is exactly the string fact_shopify_line_items.product_id already stores
// -- no separate numeric-id extraction needed on the Shopify side.
const META_PRODUCT_ITEM_PATTERN = /^\/products\/([^/#?]+)/;
const GOOGLE_PRODUCT_ITEM_PATTERN = /^shopify_zz_(\d+)_(\d+)$/;

export interface AdMetric {
  spend: number;
  impressions: number;
}

/** Ad spend/impressions from fact_shopping_product_performance, decoded and
 * re-keyed to product-level Shopify identifiers -- Google by product gid
 * (variant dropped), Meta by product handle. Exported -- routes/projection.ts
 * reuses it for the Projection Sheet's per-product CPM (Meta catalog spend/
 * impressions, previous month) rather than re-deriving the same decode. */
export async function fetchAdMetricsByProductKeys(
  from: string,
  to: string
): Promise<{ googleByProductGid: Map<string, AdMetric>; metaByHandle: Map<string, AdMetric> }> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select platform::text as platform, product_item_id,
            coalesce(sum(spend), 0)::float8 as spend,
            coalesce(sum(impressions), 0)::float8 as impressions
     from fact_shopping_product_performance
     where date between $1 and $2 and product_item_id is not null
     group by platform, product_item_id`,
    [from, to]
  );

  const googleByProductGid = new Map<string, AdMetric>();
  const metaByHandle = new Map<string, AdMetric>();
  for (const r of rows) {
    if (r.platform === "google") {
      const m = String(r.product_item_id).match(GOOGLE_PRODUCT_ITEM_PATTERN);
      if (!m) continue;
      const key = `gid://shopify/Product/${m[1]}`;
      const cur = googleByProductGid.get(key);
      googleByProductGid.set(key, { spend: (cur?.spend ?? 0) + r.spend, impressions: (cur?.impressions ?? 0) + r.impressions });
    } else if (r.platform === "meta") {
      const m = String(r.product_item_id).match(META_PRODUCT_ITEM_PATTERN);
      if (!m) continue;
      const key = m[1];
      const cur = metaByHandle.get(key);
      metaByHandle.set(key, { spend: (cur?.spend ?? 0) + r.spend, impressions: (cur?.impressions ?? 0) + r.impressions });
    }
  }
  return { googleByProductGid, metaByHandle };
}

/** "High" if strictly above the cross-sectional median, "low" (<=) otherwise
 * -- a defensible split with no arbitrary fixed threshold, same convention
 * used for the "isRightSkewed" mean-vs-median comparisons elsewhere. */
function classifyQuadrant(spend: number, revenue: number, spendMedian: number, revenueMedian: number): ProductQuadrant {
  const highSpend = spend > spendMedian;
  const highRevenue = revenue > revenueMedian;
  if (!highSpend && highRevenue) return "Q1"; // low spend, high sales
  if (highSpend && highRevenue) return "Q2"; // high spend, high sales
  if (highSpend && !highRevenue) return "Q3"; // high spend, low sales
  return "Q4"; // low spend, low sales
}

// GET /shopify/product-quadrants?from&to
shopifyRouter.get(
  "/product-quadrants",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const [{ rows }, adMetrics, skuTokenMetrics, sessionsByHandle, sessionsByHandleByPlatform, cogsRate] = await Promise.all([
      pool.query(
        `select
           product_id,
           max(product_handle) as product_handle,
           max(sku) as sku,
           array_agg(distinct upper(sku)) filter (where sku is not null) as skus,
           max(title) as title,
           max(product_type) as product_type,
           max(vendor) as vendor,
           sum(quantity)::float8 as units_sold,
           sum(line_total)::float8 as revenue
         from fact_shopify_line_items
         where date between $1 and $2
         group by product_id`,
        [range.from, range.to]
      ),
      fetchAdMetricsByProductKeys(range.from, range.to),
      fetchSkuAttributedMetricsByToken(range.from, range.to),
      fetchProductSessionsSafe(range.from, range.to),
      fetchProductSessionsByPlatformSafe(range.from, range.to),
      getCogsRate(),
    ]);

    const allRows: ProductQuadrantRow[] = rows.map((r) => {
      const google = r.product_id ? adMetrics.googleByProductGid.get(r.product_id) : undefined;
      const meta = r.product_handle ? adMetrics.metaByHandle.get(r.product_handle) : undefined;
      const skus: string[] = r.skus ?? [];
      const skuAttributed = skuAttributedMetricsForProduct(skus, skuTokenMetrics);

      const skuAttributedSpend = skuAttributed.spend;
      const metaCatalogSpend = meta?.spend ?? 0;
      const googleSpend = google?.spend ?? 0;
      const adSpend = skuAttributedSpend + metaCatalogSpend + googleSpend;
      const adImpressions = skuAttributed.impressions + (meta?.impressions ?? 0) + (google?.impressions ?? 0);

      const sessions = r.product_handle ? (sessionsByHandle.get(r.product_handle) ?? null) : null;
      const googleSessions = r.product_handle ? (sessionsByHandleByPlatform.google.get(r.product_handle) ?? null) : null;
      const metaSessions = r.product_handle ? (sessionsByHandleByPlatform.meta.get(r.product_handle) ?? null) : null;
      const marketingSessions = googleSessions == null && metaSessions == null ? null : (googleSessions ?? 0) + (metaSessions ?? 0);

      const revenue = r.revenue;
      const cogs = revenue * cogsRate;
      const grossProfit = revenue - cogs;

      return {
        productId: r.product_id ?? "unknown",
        title: r.title,
        sku: r.sku,
        productType: r.product_type,
        vendor: r.vendor,
        unitsSold: r.units_sold,
        revenue,
        skuAttributedSpend,
        metaCatalogSpend,
        googleSpend,
        adSpend,
        adImpressions,
        sessions,
        marketingSessions,
        cvr: safeDivide(r.units_sold, sessions),
        cogs,
        grossProfit,
        poas: adSpend > 0 ? grossProfit / adSpend : null,
        roas: adSpend > 0 ? revenue / adSpend : null,
        quadrant: null, // filled in below, once active-set medians are known
      };
    });

    // Exclude products with neither revenue nor ad spend this period --
    // nothing to classify, and including them would drag both medians
    // toward zero and misclassify everything else as "high".
    const active = allRows.filter((p) => p.revenue > 0 || p.adSpend > 0);
    const excludedInactiveCount = allRows.length - active.length;

    const spendMedian = median(active.map((p) => p.adSpend)) ?? 0;
    const revenueMedian = median(active.map((p) => p.revenue)) ?? 0;

    const products: ProductQuadrantRow[] = active.map((p) => ({
      ...p,
      quadrant: classifyQuadrant(p.adSpend, p.revenue, spendMedian, revenueMedian),
    }));

    // Correlation, cross-sectional (one point per product, not per day):
    // sessions/marketingSessions vs revenue. Only products with a non-null
    // session figure are eligible pairs -- pearsonCorrelation's own n>=10
    // guard keeps this null when too few products have session data.
    const sessionPairs = active.filter((p) => p.sessions != null);
    const sessionsVsRevenue = pearsonCorrelation(
      sessionPairs.map((p) => p.sessions as number),
      sessionPairs.map((p) => p.revenue)
    );
    const marketingPairs = active.filter((p) => p.marketingSessions != null);
    const marketingSessionsVsRevenue = pearsonCorrelation(
      marketingPairs.map((p) => p.marketingSessions as number),
      marketingPairs.map((p) => p.revenue)
    );

    // Cross-sectional OLS across products (revenue ~ adSpend) -- the "if you
    // spent X more on this product, expect ~X*beta1 more revenue" projection
    // the frontend's risk-modeling panel uses. r2 always shipped alongside
    // so a weak fit is never presented as a confident forecast.
    const spendRevenueRegression = linearRegression(
      active.map((p) => p.adSpend),
      active.map((p) => p.revenue)
    );

    const response: ProductQuadrantsResponse = {
      from: range.from,
      to: range.to,
      cogsRate,
      spendMedian,
      revenueMedian,
      products,
      excludedInactiveCount,
      sessionsVsRevenue,
      marketingSessionsVsRevenue,
      spendRevenueRegression,
    };
    res.json(response);
  })
);
