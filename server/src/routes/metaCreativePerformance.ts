import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { parseCreativeTag, isTaggedCreative } from "../util/creativeTag";
import type {
  MetaCreativeAdRow,
  MetaCreativeAdSetGroup,
  MetaCreativeCampaignGroup,
  MetaCreativeProductGroup,
  MetaCreativePerformanceResponse,
} from "@fig/shared";

// Meta-only, a second lens on the SKU Attribution feature: instead of just a
// bare SKU token, the ad's name carries a full structured creative tag
// wrapped in "$...$" (server/src/util/creativeTag.ts has the parsing rules
// and rationale). Same Campaign > Ad Set > Ad tree as SKU Attribution, plus
// a Product (SKU) view with the full per-creative breakdown nested in --
// "this product has N creatives, here's how each is performing and its
// status" is the ask this exists to answer.
export const metaCreativePerformanceRouter = Router();

function parseDateRange(query: Record<string, unknown>): { from: string; to: string } | null {
  const from = typeof query.from === "string" ? query.from : null;
  const to = typeof query.to === "string" ? query.to : null;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface FlatAd extends MetaCreativeAdRow {
  campaignId: string;
  campaignName: string | null;
  adSetId: string;
  adSetName: string | null;
}

type Rollup = Pick<
  MetaCreativeAdRow,
  "spend" | "impressions" | "clicks" | "conversions" | "ctr" | "cvr" | "cpc" | "cpa" | "adsRevenue" | "adsRoas" | "websiteRevenue" | "websiteRoas"
>;

/** Weighted rollup (sum/sum, never averaged) -- identical shape/semantics to
 * metaSkuAttribution.ts's rollUp, kept as its own copy since the two
 * features' row shapes have diverged (this one carries the creative-tag
 * fields SKU Attribution doesn't). */
function rollUp(ads: { spend: number; impressions: number; clicks: number; conversions: number; adsRevenue: number; websiteRevenue: number | null }[]): Rollup {
  const spend = ads.reduce((s, a) => s + a.spend, 0);
  const impressions = ads.reduce((s, a) => s + a.impressions, 0);
  const clicks = ads.reduce((s, a) => s + a.clicks, 0);
  const conversions = ads.reduce((s, a) => s + a.conversions, 0);
  const adsRevenue = ads.reduce((s, a) => s + a.adsRevenue, 0);
  const matched = ads.filter((a) => a.websiteRevenue != null);
  const websiteRevenue = matched.length > 0 ? matched.reduce((s, a) => s + (a.websiteRevenue ?? 0), 0) : null;
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

// GET /meta-creative-performance?from&to
metaCreativePerformanceRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const range = parseDateRange(req.query as Record<string, unknown>);
    if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });

    const pool = getPool();
    const [{ rows: adRows }, { rows: skuRows }] = await Promise.all([
      pool.query(
        `select
           ad_id, max(ad_name) as ad_name, max(ad_type) as ad_type, max(ad_status) as ad_status,
           ad_group_id, max(ad_group_name) as ad_group_name,
           max(campaign_id) as campaign_id, max(campaign_name) as campaign_name,
           coalesce(sum(spend), 0)::float8 as spend,
           coalesce(sum(impressions), 0)::float8 as impressions,
           coalesce(sum(clicks), 0)::float8 as clicks,
           coalesce(sum(conversions), 0)::float8 as conversions,
           coalesce(sum(revenue), 0)::float8 as ads_revenue
         from fact_ad_creative_performance
         where date between $1 and $2 and platform::text = 'meta'
         group by ad_id, ad_group_id`,
        [range.from, range.to]
      ),
      // Same cheap all-SKUs-at-once query as metaSkuAttribution.ts -- prefix
      // matching against parsed tokens happens in Node below.
      pool.query(
        `select sku, max(title) as title, coalesce(sum(line_total), 0)::float8 as revenue
         from fact_shopify_line_items
         where date between $1 and $2 and sku is not null
         group by sku`,
        [range.from, range.to]
      ),
    ]);

    const tokenRevenueCache = new Map<string, number | null>();
    function revenueForToken(token: string): number | null {
      const cached = tokenRevenueCache.get(token);
      if (cached !== undefined) return cached;
      const matches = skuRows.filter((r) => (r.sku as string).toUpperCase().startsWith(token));
      const value = matches.length > 0 ? matches.reduce((sum, r) => sum + (r.revenue as number), 0) : null;
      tokenRevenueCache.set(token, value);
      return value;
    }

    const tokenProductCache = new Map<string, { title: string | null; variantCount: number }>();
    function productForToken(token: string): { title: string | null; variantCount: number } {
      const cached = tokenProductCache.get(token);
      if (cached) return cached;
      const matches = skuRows.filter((r) => (r.sku as string).toUpperCase().startsWith(token));
      const distinctTitles = new Set(matches.map((r) => r.title).filter(Boolean));
      const dominant = [...matches].sort((a, b) => (b.revenue as number) - (a.revenue as number))[0];
      const value = { title: (dominant?.title as string | undefined) ?? null, variantCount: distinctTitles.size };
      tokenProductCache.set(token, value);
      return value;
    }

    const ads: FlatAd[] = adRows.map((r) => {
      const tag = parseCreativeTag(r.ad_name);
      const websiteRevenue = tag.sku ? revenueForToken(tag.sku) : null;
      return {
        adId: r.ad_id,
        adName: r.ad_name,
        adType: r.ad_type,
        adStatus: r.ad_status,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        adSetId: r.ad_group_id,
        adSetName: r.ad_group_name,
        sku: tag.sku,
        format: tag.format,
        angle: tag.angle,
        style: tag.style,
        gender: tag.gender,
        version: tag.version,
        variant: tag.variant,
        tagged: isTaggedCreative(tag),
        spend: r.spend,
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        ctr: safeDivide(r.clicks, r.impressions),
        cvr: safeDivide(r.conversions, r.clicks),
        cpc: safeDivide(r.spend, r.clicks),
        cpa: safeDivide(r.spend, r.conversions),
        adsRevenue: r.ads_revenue,
        adsRoas: safeDivide(r.ads_revenue, r.spend),
        websiteRevenue,
        websiteRoas: websiteRevenue != null ? safeDivide(websiteRevenue, r.spend) : null,
      };
    });

    // Group into Campaign > Ad Set (identical shape to metaSkuAttribution.ts).
    const adsByCampaignThenAdSet = new Map<string, Map<string, FlatAd[]>>();
    const campaignNames = new Map<string, string | null>();
    const adSetNames = new Map<string, string | null>();

    for (const ad of ads) {
      if (!adsByCampaignThenAdSet.has(ad.campaignId)) {
        adsByCampaignThenAdSet.set(ad.campaignId, new Map());
        campaignNames.set(ad.campaignId, ad.campaignName);
      }
      const adSetMap = adsByCampaignThenAdSet.get(ad.campaignId)!;
      if (!adSetMap.has(ad.adSetId)) {
        adSetMap.set(ad.adSetId, []);
        adSetNames.set(`${ad.campaignId}|${ad.adSetId}`, ad.adSetName);
      }
      adSetMap.get(ad.adSetId)!.push(ad);
    }

    // Product (SKU) grouping: every creative tagged with the same SKU,
    // across every campaign/ad set, combined into one row -- same
    // true-ROAS fix as SKU Attribution's "sku" tab, plus the full
    // per-creative list nested in as `creatives` (format/angle/style/
    // gender/version/status per ad) for the "this product has N creatives,
    // here's how each is doing" view.
    const adsBySku = new Map<string, FlatAd[]>();
    for (const ad of ads) {
      if (!ad.sku) continue;
      if (!adsBySku.has(ad.sku)) adsBySku.set(ad.sku, []);
      adsBySku.get(ad.sku)!.push(ad);
    }
    const products: MetaCreativeProductGroup[] = [...adsBySku.entries()]
      .map(([sku, adsForSku]): MetaCreativeProductGroup => {
        const product = productForToken(sku);
        const creatives: MetaCreativeAdRow[] = adsForSku
          .map(({ campaignId: _c, campaignName: _cn, adSetId: _a, adSetName: _an, ...rest }) => rest)
          .sort((a, b) => b.spend - a.spend);
        return {
          sku,
          productTitle: product.title,
          variantCount: product.variantCount,
          creativeCount: creatives.length,
          campaignCount: new Set(adsForSku.map((a) => a.campaignId)).size,
          creatives,
          ...rollUp(creatives),
        };
      })
      .sort((a, b) => b.spend - a.spend);

    const campaigns: MetaCreativeCampaignGroup[] = [...adsByCampaignThenAdSet.entries()]
      .map(([campaignId, adSetMap]): MetaCreativeCampaignGroup => {
        const adSets: MetaCreativeAdSetGroup[] = [...adSetMap.entries()]
          .map(([adSetId, adsInSet]): MetaCreativeAdSetGroup => {
            const adRows: MetaCreativeAdRow[] = adsInSet.map(({ campaignId: _c, campaignName: _cn, adSetId: _a, adSetName: _an, ...rest }) => rest);
            return {
              adSetId,
              adSetName: adSetNames.get(`${campaignId}|${adSetId}`) ?? null,
              ads: adRows.sort((a, b) => b.spend - a.spend),
              ...rollUp(adRows),
            };
          })
          .sort((a, b) => b.spend - a.spend);

        return {
          campaignId,
          campaignName: campaignNames.get(campaignId) ?? null,
          adSets,
          ...rollUp(adSets.flatMap((s) => s.ads)),
        };
      })
      .sort((a, b) => b.spend - a.spend);

    const response: MetaCreativePerformanceResponse = {
      from: range.from,
      to: range.to,
      campaigns,
      products,
      matchedAds: ads.filter((a) => a.sku != null).length,
      taggedAds: ads.filter((a) => a.tagged).length,
      totalAds: ads.length,
    };
    res.json(response);
  })
);
