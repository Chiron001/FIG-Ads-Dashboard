import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { MIN_CAMPAIGN_HISTORY_DAYS } from "./predictiveAnalysis";
import type { Platform, ForecastAdSpendRow, CampaignForecastGroup, CampaignForecastResponse, CampaignHorizonTotals, CampaignForecastAccuracy } from "@fig/shared";
import { ALL_PLATFORMS } from "@fig/shared";

// Read-only view over forecast_ad_spend's per-campaign rows -- see
// routes/predictiveAnalysis.ts's runForecast() for where these are computed
// and stored (one shared "Recompute forecast" action powers this page and
// the Shopify Predictive Analysis page together).
export const campaignForecastRouter = Router();

const HORIZONS = [7, 14, 30] as const;
const RECENT_ACTUAL_DAYS = 30;
const MIN_ACCURACY_DAYS = 3;

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return isoDaysAgo(0);
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function mapePct(pairs: { actual: number; predicted: number }[]): number | null {
  const withActual = pairs.filter((p) => p.actual > 0);
  if (withActual.length === 0) return null;
  return (withActual.reduce((s, p) => s + Math.abs((p.actual - p.predicted) / p.actual), 0) / withActual.length) * 100;
}

campaignForecastRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const platform = typeof req.query.platform === "string" ? (req.query.platform as Platform) : null;
    if (!platform || !ALL_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: "platform is required, one of: " + ALL_PLATFORMS.join(", ") });
    }

    const pool = getPool();
    const today = todayIso();
    const recentFrom = isoDaysAgo(RECENT_ACTUAL_DAYS);

    const [{ rows: historyDepthRows }, { rows: forecastRows }, { rows: actualRows }] = await Promise.all([
      pool.query(
        `select campaign_id, max(campaign_name) as campaign_name, count(distinct date)::int as days
         from fact_ad_performance where platform::text = $1 and campaign_id is not null
         group by campaign_id`,
        [platform]
      ),
      pool.query(
        `select forecast_date::text as "forecastDate", platform::text as platform, campaign_id as "campaignId",
                campaign_name as "campaignName", predicted_spend as "predictedSpend",
                predicted_revenue as "predictedRevenue", predicted_roas as "predictedRoas",
                predicted_conversions as "predictedConversions", ci_low as "ciLow", ci_high as "ciHigh",
                model_used as "modelUsed", r2, is_reliable as "isReliable"
         from forecast_ad_spend
         where platform::text = $1 and campaign_id != 'all'
         order by forecast_date asc`,
        [platform]
      ),
      pool.query(
        `select date::text as date, campaign_id as "campaignId",
                coalesce(sum(spend),0)::float8 as spend, coalesce(sum(revenue),0)::float8 as revenue,
                coalesce(sum(conversions),0)::float8 as conversions
         from fact_ad_performance
         where platform::text = $1 and date >= $2 and campaign_id is not null
         group by date, campaign_id
         order by date asc`,
        [platform, recentFrom]
      ),
    ]);

    const historyDepth = new Map<string, { name: string | null; days: number }>();
    for (const r of historyDepthRows) historyDepth.set(r.campaign_id, { name: r.campaign_name, days: r.days });

    const forecastByCampaign = new Map<string, ForecastAdSpendRow[]>();
    for (const r of forecastRows as ForecastAdSpendRow[]) {
      if (!forecastByCampaign.has(r.campaignId)) forecastByCampaign.set(r.campaignId, []);
      forecastByCampaign.get(r.campaignId)!.push(r);
    }

    const actualByCampaign = new Map<string, { date: string; spend: number; revenue: number; conversions: number }[]>();
    for (const r of actualRows) {
      if (!actualByCampaign.has(r.campaignId)) actualByCampaign.set(r.campaignId, []);
      actualByCampaign.get(r.campaignId)!.push({ date: r.date, spend: r.spend, revenue: r.revenue, conversions: r.conversions });
    }

    const skippedCampaigns: CampaignForecastResponse["skippedCampaigns"] = [];
    const campaigns: CampaignForecastGroup[] = [];

    for (const [campaignId, { name, days }] of historyDepth.entries()) {
      if (days < MIN_CAMPAIGN_HISTORY_DAYS) {
        skippedCampaigns.push({ campaignId, campaignName: name, historyDays: days });
        continue;
      }
      const forecast = (forecastByCampaign.get(campaignId) ?? []).sort((a, b) => a.forecastDate.localeCompare(b.forecastDate));
      if (forecast.length === 0) continue; // computed on next "Recompute forecast" run, not yet present

      const futureForecast = forecast.filter((r) => r.forecastDate >= today);
      const pastForecast = forecast.filter((r) => r.forecastDate < today);

      const horizonTotals: CampaignHorizonTotals[] = HORIZONS.map((h) => {
        const slice = futureForecast.slice(0, h);
        const totalSpend = slice.reduce((s, r) => s + r.predictedSpend, 0);
        const revenueRows = slice.filter((r) => r.predictedRevenue != null);
        const totalRevenue = revenueRows.length > 0 ? revenueRows.reduce((s, r) => s + (r.predictedRevenue ?? 0), 0) : null;
        const conversionRows = slice.filter((r) => r.predictedConversions != null);
        const totalConversions = conversionRows.length > 0 ? conversionRows.reduce((s, r) => s + (r.predictedConversions ?? 0), 0) : null;
        return {
          horizonDays: h,
          totalSpend,
          totalRevenue,
          roas: totalRevenue != null ? safeDivide(totalRevenue, totalSpend) : null,
          totalConversions,
        };
      });

      // Accuracy: past forecast_date rows (preserved, not wiped -- see
      // runForecast()'s comment) compared against what fact_ad_performance
      // actually recorded for that same campaign/date.
      let accuracy: CampaignForecastAccuracy | null = null;
      if (pastForecast.length >= MIN_ACCURACY_DAYS) {
        const actualByDate = new Map((actualByCampaign.get(campaignId) ?? []).map((a) => [a.date, a]));
        const spendPairs: { actual: number; predicted: number }[] = [];
        const revenuePairs: { actual: number; predicted: number }[] = [];
        for (const f of pastForecast) {
          const actual = actualByDate.get(f.forecastDate);
          if (!actual) continue; // not yet synced for that date
          spendPairs.push({ actual: actual.spend, predicted: f.predictedSpend });
          if (f.predictedRevenue != null) revenuePairs.push({ actual: actual.revenue, predicted: f.predictedRevenue });
        }
        if (spendPairs.length >= MIN_ACCURACY_DAYS) {
          accuracy = { daysCompared: spendPairs.length, spendMapePct: mapePct(spendPairs), revenueMapePct: mapePct(revenuePairs) };
        }
      }

      campaigns.push({
        campaignId,
        campaignName: name,
        platform,
        historyDays: days,
        recentActual: (actualByCampaign.get(campaignId) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
        forecast: futureForecast,
        horizonTotals,
        accuracy,
      });
    }

    campaigns.sort(
      (a, b) =>
        (b.horizonTotals.find((h) => h.horizonDays === 14)?.totalSpend ?? 0) - (a.horizonTotals.find((h) => h.horizonDays === 14)?.totalSpend ?? 0)
    );

    const response: CampaignForecastResponse = {
      platform,
      generatedAt: new Date().toISOString(),
      minCampaignHistoryDays: MIN_CAMPAIGN_HISTORY_DAYS,
      skippedCampaigns,
      campaigns,
    };
    res.json(response);
  })
);
