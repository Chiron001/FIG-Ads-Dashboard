import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { ALL_PLATFORMS } from "@fig/shared";
import {
  twoProportionZTest,
  iqrOutliers,
  zScoreOutliers,
  pearsonCorrelation,
  diminishingReturnsFit,
  paretoAnalysis,
  contributionRanking,
} from "../stats";
import type {
  Platform,
  CompareCampaignsResponse,
  AnomaliesResponse,
  AnomalyPoint,
  DiagnosticsResponse,
  CorrelationSummary,
  PortfolioResponse,
} from "@fig/shared";

export const statsRouter = Router();

function parseDateRange(query: Record<string, unknown>): { from: string; to: string } | null {
  const from = typeof query.from === "string" ? query.from : null;
  const to = typeof query.to === "string" ? query.to : null;
  if (!from || !to) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

function requirePlatform(query: Record<string, unknown>): Platform | null {
  const platform = query.platform;
  return typeof platform === "string" && (ALL_PLATFORMS as string[]).includes(platform) ? (platform as Platform) : null;
}

async function campaignTotals(platform: Platform, campaignId: string, from: string, to: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `select max(campaign_name) as campaign_name,
            coalesce(sum(clicks),0)::float8 as clicks,
            coalesce(sum(conversions),0)::float8 as conversions
     from fact_ad_performance
     where date between $1 and $2 and platform::text = $3 and campaign_id = $4
     group by campaign_id`,
    [from, to, platform, campaignId]
  );
  return rows[0] ?? { campaign_name: null, clicks: 0, conversions: 0 };
}

// GET /stats/compare?platform&from&to&campaignA&campaignB
statsRouter.get(
  "/compare",
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const range = parseDateRange(q);
    const platform = requirePlatform(q);
    const campaignA = typeof q.campaignA === "string" ? q.campaignA : null;
    const campaignB = typeof q.campaignB === "string" ? q.campaignB : null;
    if (!range || !platform || !campaignA || !campaignB) {
      return res.status(400).json({ error: "from/to/platform/campaignA/campaignB required" });
    }

    const [a, b] = await Promise.all([
      campaignTotals(platform, campaignA, range.from, range.to),
      campaignTotals(platform, campaignB, range.from, range.to),
    ]);

    const test = twoProportionZTest(a.conversions, a.clicks, b.conversions, b.clicks);

    const response: CompareCampaignsResponse = {
      campaignA: { campaignId: campaignA, campaignName: a.campaign_name, conversions: a.conversions, clicks: a.clicks, cvr: test.p1 },
      campaignB: { campaignId: campaignB, campaignName: b.campaign_name, conversions: b.conversions, clicks: b.clicks, cvr: test.p2 },
      z: test.z,
      significant: test.significant,
      verdict: test.verdict,
      confidence: test.confidence,
    };
    res.json(response);
  })
);

// GET /stats/anomalies?platform&from&to&campaignId
statsRouter.get(
  "/anomalies",
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const range = parseDateRange(q);
    const platform = requirePlatform(q);
    const campaignId = typeof q.campaignId === "string" ? q.campaignId : null;
    if (!range || !platform || !campaignId) {
      return res.status(400).json({ error: "from/to/platform/campaignId required" });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `select date::text as date, sum(spend)::float8 as spend, sum(conversions)::float8 as conversions
       from fact_ad_performance
       where date between $1 and $2 and platform::text = $3 and campaign_id = $4
       group by date
       order by date asc`,
      [range.from, range.to, platform, campaignId]
    );

    const spendDays = rows;
    const cpaDays = rows.filter((r) => r.conversions > 0).map((r) => ({ date: r.date, cpa: r.spend / r.conversions }));

    // IQR primary (spec §2), z-score only if IQR's n>=8 gate isn't met by
    // itself but z-score has no such gate -- we still surface it as a
    // secondary cross-check, never as the primary signal.
    const spendFlags = iqrOutliers(spendDays, (d) => d.spend);
    const spendFlagsZ = spendFlags.length === 0 ? zScoreOutliers(spendDays, (d) => d.spend) : [];
    const cpaFlags = iqrOutliers(cpaDays, (d) => d.cpa);
    const cpaFlagsZ = cpaFlags.length === 0 ? zScoreOutliers(cpaDays, (d) => d.cpa) : [];

    const toPoint = <T extends { date: string }>(f: { item: T; value: number; direction: "high" | "low"; fenceDistance: number }): AnomalyPoint => ({
      date: f.item.date,
      value: f.value,
      direction: f.direction,
      fenceDistance: f.fenceDistance,
    });

    const response: AnomaliesResponse = {
      campaignId,
      n: rows.length,
      spend: [...spendFlags, ...spendFlagsZ].map(toPoint),
      cpa: [...cpaFlags, ...cpaFlagsZ].map(toPoint),
      metGate: rows.length >= 8,
    };
    res.json(response);
  })
);

// GET /stats/diagnostics?platform&from&to&campaignId
statsRouter.get(
  "/diagnostics",
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const range = parseDateRange(q);
    const platform = requirePlatform(q);
    const campaignId = typeof q.campaignId === "string" ? q.campaignId : null;
    const grossMargin = Number(q.grossMargin ?? 0.6);
    if (!range || !platform || !campaignId) {
      return res.status(400).json({ error: "from/to/platform/campaignId required" });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `select date::text as date,
              sum(spend)::float8 as spend, sum(impressions)::float8 as impressions,
              sum(clicks)::float8 as clicks, sum(conversions)::float8 as conversions,
              sum(revenue)::float8 as revenue
       from fact_ad_performance
       where date between $1 and $2 and platform::text = $3 and campaign_id = $4
       group by date
       order by date asc`,
      [range.from, range.to, platform, campaignId]
    );

    const spendVsRoasPairs = rows.filter((r) => r.spend > 0).map((r) => ({ spend: r.spend, roas: r.revenue / r.spend }));
    const spendVsRoas = pearsonCorrelation(
      spendVsRoasPairs.map((p) => p.spend),
      spendVsRoasPairs.map((p) => p.roas)
    );

    const ctrVsCvrPairs = rows
      .filter((r) => r.impressions > 0 && r.clicks > 0)
      .map((r) => ({ ctr: r.clicks / r.impressions, cvr: r.conversions / r.clicks }));
    const ctrVsCvr = pearsonCorrelation(
      ctrVsCvrPairs.map((p) => p.ctr),
      ctrVsCvrPairs.map((p) => p.cvr)
    );

    const avgOrderValue = rows.length > 0 ? rows.reduce((s, r) => s + r.revenue, 0) / Math.max(1, rows.reduce((s, r) => s + r.conversions, 0)) : 0;
    const breakEvenRoas = grossMargin > 0 ? 1 / grossMargin : 0;
    const dr = diminishingReturnsFit(
      rows.map((r) => r.spend),
      rows.map((r) => r.conversions),
      avgOrderValue,
      breakEvenRoas
    );

    const toSummary = (c: { r: number; n: number; strength: "weak" | "moderate" | "strong" } | null): CorrelationSummary | null =>
      c ? { r: c.r, n: c.n, strength: c.strength, label: "association, not causation" } : null;

    const response: DiagnosticsResponse = {
      campaignId,
      spendVsRoas: toSummary(spendVsRoas),
      ctrVsCvr: toSummary(ctrVsCvr),
      diminishingReturns: dr
        ? { n: dr.fit.n, beta1: dr.fit.beta1, r2: dr.fit.r2, reliable: dr.reliable, budgetCeiling: dr.budgetCeiling }
        : null,
    };
    res.json(response);
  })
);

// GET /stats/portfolio?platform&from&to&grossMargin
statsRouter.get(
  "/portfolio",
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const range = parseDateRange(q);
    const platform = requirePlatform(q);
    const grossMargin = Number(q.grossMargin ?? 0.6);
    if (!range || !platform) {
      return res.status(400).json({ error: "from/to/platform required" });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `select campaign_id, max(campaign_name) as campaign_name,
              coalesce(sum(spend),0)::float8 as spend, coalesce(sum(revenue),0)::float8 as revenue
       from fact_ad_performance
       where date between $1 and $2 and platform::text = $3
       group by campaign_id`,
      [range.from, range.to, platform]
    );

    const campaigns = rows.map((r) => ({ campaignId: r.campaign_id, campaignName: r.campaign_name, revenue: r.revenue, spend: r.spend }));
    const pareto = paretoAnalysis(campaigns);
    const contribution = contributionRanking(campaigns, grossMargin);

    const response: PortfolioResponse = {
      from: range.from,
      to: range.to,
      platform,
      campaignsToEightyPercent: pareto.campaignsToEightyPercent,
      totalCampaigns: pareto.totalCampaigns,
      pareto: pareto.points,
      contribution,
    };
    res.json(response);
  })
);
