import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { ALL_PLATFORMS, computeDerivedMetrics } from "@fig/shared";
import { coefficientOfVariation, reliabilityLabel, isRightSkewed, wilsonInterval, marginalRoas as computeMarginalRoas, paretoAnalysis } from "../stats";
import { computeReconciliation } from "../util/reconciliation";
import type {
  Platform,
  DerivedMetrics,
  PlatformTotals,
  MetricsSummaryResponse,
  TimeseriesMetric,
  TimeseriesPoint,
  MetricsTimeseriesResponse,
  CampaignRow,
  MetricsCampaignsResponse,
  ProductGroupBy,
  ProductPerformanceRow,
  MetricsProductsResponse,
  ProductParetoPointDTO,
  TailLeakRow,
  MetricsProductsParetoResponse,
  AdRow,
  MetricsAdsResponse,
  GrainPlatform,
} from "@fig/shared";

// Products/Ads reconciliation tolerances (spec §0/§6): product-grain spend
// is genuinely ~5% short of campaign spend (item-level attribution gaps);
// ad-grain spend should match almost exactly.
const PRODUCT_RECONCILIATION_TOLERANCE = 0.05;
const AD_RECONCILIATION_TOLERANCE = 0.01;

export const metricsRouter = Router();

const RAW_METRICS = ["spend", "impressions", "clicks", "conversions", "revenue"] as const;
const DERIVED_METRICS = ["ctr", "cpc", "cpm", "roas", "acos", "cvr"] as const;
const ZERO_TOTALS = { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };

function parsePlatforms(raw: unknown): Platform[] {
  if (typeof raw !== "string" || raw.length === 0) return ALL_PLATFORMS;
  const requested = raw.split(",").map((p) => p.trim()) as Platform[];
  const valid = requested.filter((p) => (ALL_PLATFORMS as string[]).includes(p));
  return valid.length > 0 ? valid : ALL_PLATFORMS;
}

function parseDateRange(query: Record<string, unknown>): { from: string; to: string } | null {
  const from = typeof query.from === "string" ? query.from : null;
  const to = typeof query.to === "string" ? query.to : null;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

// GET /metrics/summary?from&to&platforms=google,meta
metricsRouter.get("/summary", asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });
  const platforms = parsePlatforms(req.query.platforms);

  const pool = getPool();
  const { rows } = await pool.query(
    `select platform::text as platform,
            coalesce(sum(spend),0)::float8 as spend,
            coalesce(sum(impressions),0)::float8 as impressions,
            coalesce(sum(clicks),0)::float8 as clicks,
            coalesce(sum(conversions),0)::float8 as conversions,
            coalesce(sum(revenue),0)::float8 as revenue
     from fact_ad_performance
     where date between $1 and $2 and platform::text = any($3::text[])
     group by platform`,
    [range.from, range.to, platforms]
  );
  const byPlatform = new Map(rows.map((r) => [r.platform as Platform, r]));

  const platformTotals: PlatformTotals[] = platforms.map((platform) => {
    const totals = byPlatform.get(platform) ?? ZERO_TOTALS;
    return { platform, ...totals, ...computeDerivedMetrics(totals) };
  });

  const blendedRaw = platformTotals.reduce(
    (acc, p) => ({
      spend: acc.spend + p.spend,
      impressions: acc.impressions + p.impressions,
      clicks: acc.clicks + p.clicks,
      conversions: acc.conversions + p.conversions,
      revenue: acc.revenue + p.revenue,
    }),
    { ...ZERO_TOTALS }
  );

  const response: MetricsSummaryResponse = {
    from: range.from,
    to: range.to,
    platforms: platformTotals,
    blended: { ...blendedRaw, ...computeDerivedMetrics(blendedRaw), label: "blended, non-attributed" },
  };
  res.json(response);
}));

// GET /metrics/timeseries?from&to&platforms=google,meta&metric=spend
metricsRouter.get("/timeseries", asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });
  const platforms = parsePlatforms(req.query.platforms);
  const metric = (typeof req.query.metric === "string" ? req.query.metric : "spend") as TimeseriesMetric;
  const isRaw = (RAW_METRICS as readonly string[]).includes(metric);
  const isDerived = (DERIVED_METRICS as readonly string[]).includes(metric);
  if (!isRaw && !isDerived) {
    return res.status(400).json({ error: `invalid metric: ${metric}` });
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `select date::text as date, platform::text as platform,
            coalesce(sum(spend),0)::float8 as spend,
            coalesce(sum(impressions),0)::float8 as impressions,
            coalesce(sum(clicks),0)::float8 as clicks,
            coalesce(sum(conversions),0)::float8 as conversions,
            coalesce(sum(revenue),0)::float8 as revenue
     from fact_ad_performance
     where date between $1 and $2 and platform::text = any($3::text[])
     group by date, platform
     order by date asc`,
    [range.from, range.to, platforms]
  );

  const pointsByDate = new Map<string, TimeseriesPoint>();
  for (const row of rows) {
    let point = pointsByDate.get(row.date);
    if (!point) {
      point = { date: row.date };
      pointsByDate.set(row.date, point);
    }
    const value = isRaw ? row[metric] : computeDerivedMetrics(row)[metric as keyof DerivedMetrics];
    point[row.platform as Platform] = value;
  }

  const response: MetricsTimeseriesResponse = {
    from: range.from,
    to: range.to,
    metric,
    platforms,
    points: Array.from(pointsByDate.values()),
  };
  res.json(response);
}));

/** Equal-length period immediately preceding `from` -- e.g. from=08-09..to=08-15
 * (7 days) -> prior 08-02..08-08. Used for ROAS Δ WoW; "WoW" as a spec name
 * but genuinely "prior period of the same length", not literally always 7 days. */
function priorPeriod(from: string, to: string): { from: string; to: string } {
  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");
  const spanMs = toDate.getTime() - fromDate.getTime(); // inclusive span between the two dates
  const priorTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const priorFrom = new Date(priorTo.getTime() - spanMs);
  return { from: priorFrom.toISOString().slice(0, 10), to: priorTo.toISOString().slice(0, 10) };
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

// GET /metrics/campaigns?from&to&platform=google
metricsRouter.get("/campaigns", asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });
  const platform = req.query.platform;
  if (typeof platform !== "string" || !(ALL_PLATFORMS as string[]).includes(platform)) {
    return res.status(400).json({ error: "platform required (one of google, meta, amazon, myntra)" });
  }

  const pool = getPool();
  // dim_campaign (full roster, any status) LEFT-merged with performance
  // for the range -- a FULL OUTER JOIN so campaigns show up whether they
  // have activity in this range (fact), are known but quiet/paused
  // (roster-only), or predate the roster table entirely (fact-only,
  // status null). See db/migrations/0002_dim_campaign.sql.
  //
  // search_impression_share / search_budget_lost_impression_share are
  // campaign-level-per-day, not additive across the ad_group rows they're
  // (necessarily) stored alongside -- MAX() picks up the single value
  // rather than SUM()ing a percentage into nonsense. See
  // db/migrations/0003_search_impression_share.sql.
  const { rows } = await pool.query(
    `with fact as (
       select campaign_id, max(campaign_name) as campaign_name,
              sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
              sum(conversions) as conversions, sum(revenue) as revenue,
              max(search_impression_share) as search_impression_share,
              max(search_budget_lost_impression_share) as search_budget_lost_impression_share
       from fact_ad_performance
       where date between $1 and $2 and platform::text = $3
       group by campaign_id
     ),
     roster as (
       select campaign_id, campaign_name, status
       from dim_campaign
       where platform::text = $3
     )
     select
       coalesce(r.campaign_id, f.campaign_id) as campaign_id,
       coalesce(r.campaign_name, f.campaign_name) as campaign_name,
       r.status as status,
       coalesce(f.spend, 0)::float8 as spend,
       coalesce(f.impressions, 0)::float8 as impressions,
       coalesce(f.clicks, 0)::float8 as clicks,
       coalesce(f.conversions, 0)::float8 as conversions,
       coalesce(f.revenue, 0)::float8 as revenue,
       f.search_impression_share::float8 as search_impression_share,
       f.search_budget_lost_impression_share::float8 as search_budget_lost_impression_share
     from roster r
     full outer join fact f on f.campaign_id = r.campaign_id
     order by spend desc nulls last`,
    [range.from, range.to, platform]
  );

  const prior = priorPeriod(range.from, range.to);
  const { rows: priorRows } = await pool.query(
    `select campaign_id, sum(spend)::float8 as spend, sum(revenue)::float8 as revenue
     from fact_ad_performance
     where date between $1 and $2 and platform::text = $3
     group by campaign_id`,
    [prior.from, prior.to, platform]
  );
  const priorByCampaign = new Map(priorRows.map((r) => [r.campaign_id as string, r]));

  // Daily per-campaign series -- needed for reliability (CV of daily ROAS),
  // skew flags, and outlier/diagnostics work elsewhere. The aggregate query
  // above can't derive these; CV/skew are properties of the day-to-day
  // *distribution*, not the summed total.
  const { rows: dailyRows } = await pool.query(
    `select campaign_id, date::text as date,
            sum(spend)::float8 as spend, sum(clicks)::float8 as clicks,
            sum(conversions)::float8 as conversions, sum(revenue)::float8 as revenue
     from fact_ad_performance
     where date between $1 and $2 and platform::text = $3
     group by campaign_id, date`,
    [range.from, range.to, platform]
  );
  const dailyByCampaign = new Map<string, typeof dailyRows>();
  for (const d of dailyRows) {
    const list = dailyByCampaign.get(d.campaign_id) ?? [];
    list.push(d);
    dailyByCampaign.set(d.campaign_id, list);
  }

  const campaigns: CampaignRow[] = rows.map((r) => {
    const derived = computeDerivedMetrics(r);
    const priorRow = priorByCampaign.get(r.campaign_id);
    const priorRoas = priorRow ? safeDivide(priorRow.revenue, priorRow.spend) : null;
    const roasDeltaWoW = derived.roas != null && priorRoas != null && priorRoas !== 0 ? (derived.roas - priorRoas) / priorRoas : null;
    const marginalRoas = priorRow ? computeMarginalRoas(r.revenue, r.spend, priorRow.revenue, priorRow.spend) : null;

    // Reliability (spec §1): CV of daily ROAS, excluding zero-spend days
    // (ROAS undefined there, not 0). Skew flags on daily ROAS and daily CPA.
    const daily = dailyByCampaign.get(r.campaign_id) ?? [];
    const dailyRoas = daily.filter((d) => d.spend > 0).map((d) => d.revenue / d.spend);
    const dailyCpa = daily.filter((d) => d.conversions > 0).map((d) => d.spend / d.conversions);
    const cv = coefficientOfVariation(dailyRoas);

    const cvrCI = r.clicks > 0 ? wilsonInterval(r.conversions, r.clicks) : null;

    return {
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      status: r.status,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      revenue: r.revenue,
      searchImpressionShare: r.search_impression_share,
      searchBudgetLostImpressionShare: r.search_budget_lost_impression_share,
      roasDeltaWoW,
      reliability: { cv, label: reliabilityLabel(cv) },
      roasSkewed: isRightSkewed(dailyRoas),
      cpaSkewed: isRightSkewed(dailyCpa),
      cvrCI: cvrCI ? { low: cvrCI.low, high: cvrCI.high, confidence: cvrCI.confidence } : null,
      marginalRoas,
      ...derived,
    };
  });

  const response: MetricsCampaignsResponse = { from: range.from, to: range.to, platform: platform as Platform, campaigns };
  res.json(response);
}));

// --- Product-level and ad-level grain (Google + Meta) -----------------------
//
// Two separate breakdowns of the SAME campaign spend fact_ad_performance
// already holds -- never summed with campaign or ad-grain totals. See
// db/migrations/0005_google_product_ad_grain.sql,
// db/migrations/0006_generalize_product_ad_grain.sql, and the build spec's
// "Critical modeling rule" (§0). Amazon/Myntra have no connector for either
// grain (Amazon on hold, Myntra CSV-only) -- these routes 400 for anything
// other than google/meta.

function parseGrainPlatform(raw: unknown): GrainPlatform | null {
  if (raw === "google" || raw === "meta") return raw;
  if (raw == null || raw === "") return "google"; // back-compat default, pre-dates the ?platform= param
  return null;
}

/** Campaign-grain spend for the same filter, to reconcile a breakdown
 * grain against. */
async function campaignSpendForReconciliation(platform: GrainPlatform, from: string, to: string, campaignId: string | null): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select coalesce(sum(spend), 0)::float8 as spend
     from fact_ad_performance
     where date between $1 and $2 and platform::text = $3
       ${campaignId ? "and campaign_id = $4" : ""}`,
    campaignId ? [from, to, platform, campaignId] : [from, to, platform]
  );
  return rows[0]?.spend ?? 0;
}

// GET /metrics/products?from&to&platform=google|meta&campaign_id?&group_by=sku|type_l1|type_l2
metricsRouter.get("/products", asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });
  const platform = parseGrainPlatform(req.query.platform);
  if (!platform) return res.status(400).json({ error: "platform must be one of: google, meta" });

  const campaignId = typeof req.query.campaign_id === "string" ? req.query.campaign_id : null;
  const groupByRaw = typeof req.query.group_by === "string" ? req.query.group_by : "type_l1";
  if (!["sku", "type_l1", "type_l2"].includes(groupByRaw)) {
    return res.status(400).json({ error: "group_by must be one of: sku, type_l1, type_l2" });
  }
  const groupBy = groupByRaw as ProductGroupBy;

  const pool = getPool();
  const params: unknown[] = [range.from, range.to, platform];
  const campaignFilter = campaignId ? (params.push(campaignId), `and campaign_id = $${params.length}`) : "";

  // Nulls in product_type_l1/l2 must not break grouping -- coalesce to a
  // literal "—" group key so ungrouped/uncategorized spend still rolls up
  // into one visible row instead of silently vanishing or fragmenting.
  // (Meta rows are always null here -- its product_id breakdown has no
  // category dimension -- so type_l1/l2 grouping folds all Meta products
  // into a single "—" row; the UI defaults Meta to SKU grouping instead.)
  const groupExpr =
    groupBy === "sku"
      ? "product_item_id"
      : groupBy === "type_l1"
        ? "coalesce(product_type_l1, '—')"
        : "coalesce(product_type_l1, '—') || '|' || coalesce(product_type_l2, '—')";

  const { rows } = await pool.query(
    `select
       ${groupExpr} as key,
       ${groupBy === "sku" ? "max(product_item_id) as product_item_id, max(product_title) as product_title," : "null as product_item_id, null as product_title,"}
       max(product_type_l1) as product_type_l1,
       ${groupBy === "type_l2" ? "max(product_type_l2)" : "null"} as product_type_l2,
       count(distinct product_item_id)::int as sku_count,
       coalesce(sum(spend), 0)::float8 as spend,
       coalesce(sum(impressions), 0)::float8 as impressions,
       coalesce(sum(clicks), 0)::float8 as clicks,
       coalesce(sum(conversions), 0)::float8 as conversions,
       coalesce(sum(revenue), 0)::float8 as revenue
     from fact_shopping_product_performance
     where date between $1 and $2 and platform::text = $3 ${campaignFilter}
     group by ${groupExpr}
     order by spend desc`,
    params
  );

  const products: ProductPerformanceRow[] = rows.map((r) => ({
    key: r.key,
    productItemId: r.product_item_id,
    productTitle: r.product_title,
    productTypeL1: r.product_type_l1,
    productTypeL2: r.product_type_l2,
    skuCount: r.sku_count,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    revenue: r.revenue,
    ...computeDerivedMetrics(r),
  }));

  const grainSpend = products.reduce((s, p) => s + p.spend, 0);
  const campaignSpend = await campaignSpendForReconciliation(platform, range.from, range.to, campaignId);

  const response: MetricsProductsResponse = {
    from: range.from,
    to: range.to,
    platform,
    groupBy,
    campaignId,
    products,
    reconciliation: computeReconciliation(grainSpend, campaignSpend, PRODUCT_RECONCILIATION_TOLERANCE),
  };
  res.json(response);
}));

// GET /metrics/products/pareto?from&to&platform=google|meta&campaign_id?
// SKU-level cumulative-revenue Pareto + tail-leak flags (spend>0, orders=0).
metricsRouter.get("/products/pareto", asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });
  const platform = parseGrainPlatform(req.query.platform);
  if (!platform) return res.status(400).json({ error: "platform must be one of: google, meta" });
  const campaignId = typeof req.query.campaign_id === "string" ? req.query.campaign_id : null;

  const pool = getPool();
  const params: unknown[] = [range.from, range.to, platform];
  const campaignFilter = campaignId ? (params.push(campaignId), `and campaign_id = $${params.length}`) : "";

  const { rows } = await pool.query(
    `select product_item_id, max(product_title) as product_title,
            coalesce(sum(spend), 0)::float8 as spend,
            coalesce(sum(conversions), 0)::float8 as conversions,
            coalesce(sum(revenue), 0)::float8 as revenue
     from fact_shopping_product_performance
     where date between $1 and $2 and platform::text = $3 ${campaignFilter}
     group by product_item_id`,
    params
  );

  const pareto = paretoAnalysis(rows.map((r) => ({ campaignId: r.product_item_id, campaignName: r.product_title, revenue: r.revenue })));
  const paretoDTO: ProductParetoPointDTO[] = pareto.points.map((p) => ({
    productItemId: p.campaignId,
    productTitle: p.campaignName,
    revenue: p.revenue,
    cumulativePct: p.cumulativePct,
  }));

  const tailLeaks: TailLeakRow[] = rows
    .filter((r) => r.spend > 0 && r.conversions === 0)
    .sort((a, b) => b.spend - a.spend)
    .map((r) => ({ productItemId: r.product_item_id, productTitle: r.product_title, spend: r.spend }));

  const response: MetricsProductsParetoResponse = {
    from: range.from,
    to: range.to,
    skusToEightyPercent: pareto.campaignsToEightyPercent,
    totalSkus: pareto.totalCampaigns,
    pareto: paretoDTO,
    tailLeaks,
  };
  res.json(response);
}));

// GET /metrics/ads?from&to&platform=google|meta&campaign_id?&ad_group_id?
metricsRouter.get("/ads", asyncHandler(async (req, res) => {
  const range = parseDateRange(req.query as Record<string, unknown>);
  if (!range) return res.status(400).json({ error: "from/to required, format YYYY-MM-DD, from <= to" });
  const platform = parseGrainPlatform(req.query.platform);
  if (!platform) return res.status(400).json({ error: "platform must be one of: google, meta" });
  const campaignId = typeof req.query.campaign_id === "string" ? req.query.campaign_id : null;
  const adGroupId = typeof req.query.ad_group_id === "string" ? req.query.ad_group_id : null;

  const pool = getPool();
  const params: unknown[] = [range.from, range.to, platform];
  let filters = "";
  if (campaignId) {
    params.push(campaignId);
    filters += ` and campaign_id = $${params.length}`;
  }
  if (adGroupId) {
    params.push(adGroupId);
    filters += ` and ad_group_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `select
       ad_id, max(ad_name) as ad_name, max(ad_type) as ad_type, max(ad_status) as ad_status,
       ad_group_id, max(ad_group_name) as ad_group_name,
       max(campaign_id) as campaign_id, max(campaign_name) as campaign_name,
       coalesce(sum(spend), 0)::float8 as spend,
       coalesce(sum(impressions), 0)::float8 as impressions,
       coalesce(sum(clicks), 0)::float8 as clicks,
       coalesce(sum(conversions), 0)::float8 as conversions,
       coalesce(sum(revenue), 0)::float8 as revenue
     from fact_ad_creative_performance
     where date between $1 and $2 and platform::text = $3 ${filters}
     group by ad_id, ad_group_id
     order by spend desc`,
    params
  );

  const ads: AdRow[] = rows.map((r) => ({
    adId: r.ad_id,
    adName: r.ad_name,
    adType: r.ad_type,
    adStatus: r.ad_status,
    adGroupId: r.ad_group_id,
    adGroupName: r.ad_group_name,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    revenue: r.revenue,
    ...computeDerivedMetrics(r),
  }));

  const grainSpend = ads.reduce((s, a) => s + a.spend, 0);
  const campaignSpend = await campaignSpendForReconciliation(platform, range.from, range.to, campaignId);

  const response: MetricsAdsResponse = {
    from: range.from,
    to: range.to,
    platform,
    campaignId,
    adGroupId,
    ads,
    reconciliation: computeReconciliation(grainSpend, campaignSpend, AD_RECONCILIATION_TOLERANCE),
  };
  res.json(response);
}));
