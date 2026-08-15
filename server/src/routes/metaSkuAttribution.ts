import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import type { MetaSkuAdRow, MetaSkuAdSetGroup, MetaSkuCampaignGroup, MetaSkuAttributionResponse } from "@fig/shared";

// Meta-only, per user request: Campaign > Ad Set > Ad drill-down, each ad's
// spend cross-referenced against Shopify's ground-truth per-SKU revenue.
// "sku" is a token matched out of the ad's *name* (starting "FIG-..."), not
// a real Meta field -- see shared/src/index.ts's header comment on
// MetaSkuAdRow for the full rationale (adsRoas vs websiteRoas, never
// blended into one number; null vs 0 for unmatched ads).
export const metaSkuAttributionRouter = Router();

function parseDateRange(query: Record<string, unknown>): { from: string; to: string } | null {
  const from = typeof query.from === "string" ? query.from : null;
  const to = typeof query.to === "string" ? query.to : null;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

// Confirmed live against real ad names: a leading emoji/junk prefix before
// "FIG-" is common (e.g. "❌FIG-05-007-RD_VID_..."), and the token itself is
// one or more hyphen-joined alphanumeric segments, ending at the first
// underscore/space/bracket ("FIG-05-007-RD_VID..." -> "FIG-05-007-RD";
// "FIG-01-029_UGC..." -> "FIG-01-029"). Normalized to uppercase to match
// Shopify's SKU casing.
const SKU_TOKEN_PATTERN = /FIG-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/i;

function extractSkuToken(adName: string | null): string | null {
  if (!adName) return null;
  const match = adName.match(SKU_TOKEN_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface FlatAd extends MetaSkuAdRow {
  campaignId: string;
  campaignName: string | null;
  adSetId: string;
  adSetName: string | null;
}

/** Weighted rollup (sum/sum, never averaged) over a group of ads --
 * websiteRevenue/websiteRoas roll up from only the ads that matched a SKU;
 * a group where none did stays null, not a misleading 0. */
function rollUp(ads: MetaSkuAdRow[]): {
  spend: number;
  adsRevenue: number;
  adsRoas: number | null;
  websiteRevenue: number | null;
  websiteRoas: number | null;
} {
  const spend = ads.reduce((s, a) => s + a.spend, 0);
  const adsRevenue = ads.reduce((s, a) => s + a.adsRevenue, 0);
  const matched = ads.filter((a) => a.websiteRevenue != null);
  const websiteRevenue = matched.length > 0 ? matched.reduce((s, a) => s + (a.websiteRevenue ?? 0), 0) : null;
  return {
    spend,
    adsRevenue,
    adsRoas: safeDivide(adsRevenue, spend),
    websiteRevenue,
    websiteRoas: websiteRevenue != null ? safeDivide(websiteRevenue, spend) : null,
  };
}

// GET /meta-sku-attribution?from&to
metaSkuAttributionRouter.get(
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
           coalesce(sum(revenue), 0)::float8 as ads_revenue
         from fact_ad_creative_performance
         where date between $1 and $2 and platform::text = 'meta'
         group by ad_id, ad_group_id`,
        [range.from, range.to]
      ),
      // All Shopify SKU revenue for the range in one cheap query -- prefix
      // matching against ad-name tokens happens in Node below rather than
      // per-token SQL round-trips (there are only ever a few hundred
      // distinct SKUs, far cheaper than N queries).
      pool.query(
        `select sku, coalesce(sum(line_total), 0)::float8 as revenue
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

    const ads: FlatAd[] = adRows.map((r) => {
      const sku = extractSkuToken(r.ad_name);
      const websiteRevenue = sku ? revenueForToken(sku) : null;
      return {
        adId: r.ad_id,
        adName: r.ad_name,
        adType: r.ad_type,
        adStatus: r.ad_status,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        adSetId: r.ad_group_id,
        adSetName: r.ad_group_name,
        sku,
        spend: r.spend,
        adsRevenue: r.ads_revenue,
        adsRoas: safeDivide(r.ads_revenue, r.spend),
        websiteRevenue,
        websiteRoas: websiteRevenue != null ? safeDivide(websiteRevenue, r.spend) : null,
      };
    });

    // Group into Campaign > Ad Set, preserving ad order (already sorted by
    // nothing in particular from the SQL group-by -- reordered by spend below).
    const adsByCampaignThenAdSet = new Map<string, Map<string, FlatAd[]>>();
    const campaignNames = new Map<string, string | null>();
    const adSetNames = new Map<string, string | null>(); // keyed "campaignId|adSetId"

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

    const campaigns: MetaSkuCampaignGroup[] = [...adsByCampaignThenAdSet.entries()]
      .map(([campaignId, adSetMap]): MetaSkuCampaignGroup => {
        const adSets: MetaSkuAdSetGroup[] = [...adSetMap.entries()]
          .map(([adSetId, adsInSet]): MetaSkuAdSetGroup => {
            const adRows: MetaSkuAdRow[] = adsInSet.map(({ campaignId: _c, campaignName: _cn, adSetId: _a, adSetName: _an, ...rest }) => rest);
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

    const response: MetaSkuAttributionResponse = {
      from: range.from,
      to: range.to,
      campaigns,
      matchedAds: ads.filter((a) => a.sku != null).length,
      totalAds: ads.length,
    };
    res.json(response);
  })
);
