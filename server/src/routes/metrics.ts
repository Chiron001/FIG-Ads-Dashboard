import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { ALL_PLATFORMS, computeDerivedMetrics } from "@fig/shared";
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
} from "@fig/shared";

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
  const { rows } = await pool.query(
    `with fact as (
       select campaign_id, max(campaign_name) as campaign_name,
              sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
              sum(conversions) as conversions, sum(revenue) as revenue
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
       coalesce(f.revenue, 0)::float8 as revenue
     from roster r
     full outer join fact f on f.campaign_id = r.campaign_id
     order by spend desc nulls last`,
    [range.from, range.to, platform]
  );

  const campaigns: CampaignRow[] = rows.map((r) => ({
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    status: r.status,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    revenue: r.revenue,
    ...computeDerivedMetrics(r),
  }));

  const response: MetricsCampaignsResponse = { from: range.from, to: range.to, platform: platform as Platform, campaigns };
  res.json(response);
}));
