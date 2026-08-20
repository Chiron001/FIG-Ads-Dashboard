import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import type { GoogleSkuProductRow, GoogleSkuCampaignGroup, GoogleSkuGroupRow, GoogleSkuAttributionResponse } from "@fig/shared";

// Google-only counterpart to metaSkuAttribution.ts, EXACT rather than a
// name-tag guess -- see GoogleSkuAttributionResponse's header comment in
// shared/src/index.ts for the full rationale (Shopping/PMax already reports
// real per-product spend, decoded and joined straight to the matching
// Shopify variant's SKU, no regex/prefix-token ambiguity).
export const googleSkuAttributionRouter = Router();

function parseDateRange(query: Record<string, unknown>): { from: string; to: string } | null {
  const from = typeof query.from === "string" ? query.from : null;
  const to = typeof query.to === "string" ? query.to : null;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

// Same pattern as metrics.ts's GOOGLE_PRODUCT_ITEM_PATTERN -- product_item_id
// is "shopify_zz_{productNumericId}_{variantNumericId}", the numeric halves
// of "gid://shopify/Product/..." and ".../ProductVariant/...".
const GOOGLE_PRODUCT_ITEM_PATTERN = /^shopify_zz_(\d+)_(\d+)$/;

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface FlatProduct extends GoogleSkuProductRow {
  campaignId: string;
  campaignName: string | null;
}

type Rollup = Pick<
  GoogleSkuProductRow,
  "spend" | "impressions" | "clicks" | "conversions" | "ctr" | "cvr" | "cpc" | "cpa" | "adsRevenue" | "adsRoas" | "websiteRevenue" | "websiteRoas"
>;

/** Weighted rollup (sum/sum, never averaged) -- identical shape/semantics to
 * metaSkuAttribution.ts's rollUp. */
function rollUp(rows: GoogleSkuProductRow[]): Rollup {
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

// GET /google-sku-attribution?from&to
googleSkuAttributionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const [{ rows: productRows }, { rows: variantRows }] = await Promise.all([
      pool.query(
        `select
           campaign_id, max(campaign_name) as campaign_name,
           product_item_id, max(product_title) as product_title,
           coalesce(sum(spend), 0)::float8 as spend,
           coalesce(sum(impressions), 0)::float8 as impressions,
           coalesce(sum(clicks), 0)::float8 as clicks,
           coalesce(sum(conversions), 0)::float8 as conversions,
           coalesce(sum(revenue), 0)::float8 as ads_revenue
         from fact_shopping_product_performance
         where date between $1 and $2 and platform::text = 'google'
         group by campaign_id, product_item_id`,
        [range.from, range.to]
      ),
      // product_id + variant_id -> sku, title, real Shopify revenue. Same
      // shape metrics.ts's fetchShopifyRevenueByProductKeys uses for the
      // Products tab's Website ROAS join, recomputed here (private to its
      // own route file, not imported) so this file also gets the sku/title.
      pool.query(
        `select product_id, variant_id, max(sku) as sku, max(title) as title, coalesce(sum(line_total), 0)::float8 as revenue
         from fact_shopify_line_items
         where date between $1 and $2 and product_id is not null and variant_id is not null
         group by product_id, variant_id`,
        [range.from, range.to]
      ),
    ]);

    const variantByKey = new Map(
      variantRows.map((r) => [`${r.product_id}|${r.variant_id}`, { sku: r.sku as string | null, title: r.title as string | null, revenue: r.revenue as number }])
    );

    const products: FlatProduct[] = productRows.map((r) => {
      const m = String(r.product_item_id).match(GOOGLE_PRODUCT_ITEM_PATTERN);
      const variant = m ? variantByKey.get(`gid://shopify/Product/${m[1]}|gid://shopify/ProductVariant/${m[2]}`) : undefined;
      const sku = variant?.sku ?? null;
      const websiteRevenue = variant?.revenue ?? null;
      const spend = r.spend as number;
      return {
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        productItemId: r.product_item_id,
        productTitle: r.product_title,
        sku,
        spend,
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        ctr: safeDivide(r.clicks, r.impressions),
        cvr: safeDivide(r.conversions, r.clicks),
        cpc: safeDivide(spend, r.clicks),
        cpa: safeDivide(spend, r.conversions),
        adsRevenue: r.ads_revenue,
        adsRoas: safeDivide(r.ads_revenue, spend),
        websiteRevenue,
        websiteRoas: websiteRevenue != null ? safeDivide(websiteRevenue, spend) : null,
      };
    });

    // Group into Campaign > Product.
    const productsByCampaign = new Map<string, FlatProduct[]>();
    const campaignNames = new Map<string, string | null>();
    for (const p of products) {
      if (!productsByCampaign.has(p.campaignId)) {
        productsByCampaign.set(p.campaignId, []);
        campaignNames.set(p.campaignId, p.campaignName);
      }
      productsByCampaign.get(p.campaignId)!.push(p);
    }

    // SKU-wise spend: combine every product_item_id that resolved to the
    // same SKU (usually one, but a SKU can run in more than one campaign),
    // same true-combined-spend fix as Meta's skuGroups.
    const productsBySku = new Map<string, FlatProduct[]>();
    for (const p of products) {
      if (!p.sku) continue;
      if (!productsBySku.has(p.sku)) productsBySku.set(p.sku, []);
      productsBySku.get(p.sku)!.push(p);
    }
    const skuGroups: GoogleSkuGroupRow[] = [...productsBySku.entries()]
      .map(([sku, rows]): GoogleSkuGroupRow => {
        const dominant = [...rows].sort((a, b) => b.spend - a.spend)[0];
        return {
          sku,
          productTitle: dominant?.productTitle ?? null,
          campaignCount: new Set(rows.map((r) => r.campaignId)).size,
          productItemCount: new Set(rows.map((r) => r.productItemId)).size,
          ...rollUp(rows),
        };
      })
      .sort((a, b) => b.spend - a.spend);

    const campaigns: GoogleSkuCampaignGroup[] = [...productsByCampaign.entries()]
      .map(([campaignId, rows]): GoogleSkuCampaignGroup => {
        const productRows: GoogleSkuProductRow[] = rows.map(({ campaignId: _c, campaignName: _cn, ...rest }) => rest);
        return {
          campaignId,
          campaignName: campaignNames.get(campaignId) ?? null,
          products: productRows.sort((a, b) => b.spend - a.spend),
          ...rollUp(productRows),
        };
      })
      .sort((a, b) => b.spend - a.spend);

    const response: GoogleSkuAttributionResponse = {
      from: range.from,
      to: range.to,
      campaigns,
      skuGroups,
      matchedProductItems: products.filter((p) => p.sku != null).length,
      totalProductItems: products.length,
    };
    res.json(response);
  })
);
