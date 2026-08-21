import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { forecastDailySeries, fillDailyGaps, type DailyPoint } from "../lib/forecast";
import { collapseGA4Channel } from "../lib/ga4Channels";
import type {
  Platform,
  ChannelBucket,
  ForecastAdSpendRow,
  ForecastShopifyRow,
  RevenueReconciliation,
  NewVsReturningBreakdown,
  FunnelLagFlag,
  PredictiveAnalysisResponse,
} from "@fig/shared";
import { ALL_PLATFORMS, ALL_CHANNEL_BUCKETS } from "@fig/shared";

export const predictiveAnalysisRouter = Router();

const HORIZON_DAYS = 30;
// Recent-window reconciliation figure -- long enough to smooth day-to-day
// noise, short enough to reflect current tracking health rather than a
// stale average over the whole history.
const RECONCILIATION_WINDOW_DAYS = 30;

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Shared first-forecast-date for every series in one computation run -- see
// forecastDailySeries's header comment in lib/forecast.ts for why this
// can't be each series' own "last history date + 1".
function tomorrowIso(): string {
  return isoDaysAgo(-1);
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

// --- forecast computation ----------------------------------------------------

async function computeAdSpendForecast(): Promise<ForecastAdSpendRow[]> {
  const startDate = tomorrowIso();
  const pool = getPool();
  const { rows } = await pool.query(
    `select date::text as date, platform::text as platform, coalesce(sum(spend),0)::float8 as spend
     from fact_ad_performance
     where platform::text = any($1::text[])
     group by date, platform
     order by date asc`,
    [ALL_PLATFORMS]
  );

  const byPlatform = new Map<Platform, { date: string; value: number }[]>();
  for (const r of rows) {
    const platform = r.platform as Platform;
    if (!byPlatform.has(platform)) byPlatform.set(platform, []);
    byPlatform.get(platform)!.push({ date: r.date, value: r.spend });
  }

  const out: ForecastAdSpendRow[] = [];
  for (const platform of ALL_PLATFORMS) {
    const series = byPlatform.get(platform) ?? [];
    // Nothing synced for this platform yet (e.g. Amazon/Myntra, on hold) --
    // nothing to forecast, not a zero-spend forecast that reads as real.
    if (series.length < 2) continue;
    const filled = fillDailyGaps(series);
    const points = forecastDailySeries(filled, HORIZON_DAYS, startDate);
    for (const p of points) {
      out.push({
        forecastDate: p.forecastDate,
        platform,
        predictedSpend: p.predictedValue,
        ciLow: p.ciLow,
        ciHigh: p.ciHigh,
        modelUsed: p.modelUsed,
        r2: p.r2,
        isReliable: p.isReliable,
      });
    }
  }
  return out;
}

interface ChannelSeriesPoint {
  date: string;
  revenue: number;
  sessions: number;
  transactions: number;
}

async function computeShopifyForecast(): Promise<ForecastShopifyRow[]> {
  const startDate = tomorrowIso();
  const pool = getPool();

  const [{ rows: orderRows }, { rows: ga4Rows }] = await Promise.all([
    pool.query(`select date::text as date, coalesce(sum(total_price),0)::float8 as revenue, count(*)::float8 as orders from fact_shopify_orders group by date order by date asc`),
    pool.query(
      `select date::text as date, channel_group, coalesce(sum(sessions),0)::float8 as sessions, coalesce(sum(revenue),0)::float8 as revenue, coalesce(sum(transactions),0)::float8 as transactions
       from fact_ga4_channel_daily group by date, channel_group order by date asc`
    ),
  ]);

  const out: ForecastShopifyRow[] = [];

  // --- "all" row: Shopify's own ground-truth revenue/orders (most accurate
  // total), plus GA4's summed sessions (only source of session data) for CVR.
  const revenueSeries = fillDailyGaps(orderRows.map((r) => ({ date: r.date, value: r.revenue })));
  const orderSeries = fillDailyGaps(orderRows.map((r) => ({ date: r.date, value: r.orders })));
  const sessionsByDate = new Map<string, number>();
  for (const r of ga4Rows) sessionsByDate.set(r.date, (sessionsByDate.get(r.date) ?? 0) + Number(r.sessions));
  const sessionSeries = fillDailyGaps([...sessionsByDate.entries()].map(([date, value]) => ({ date, value })));

  if (revenueSeries.length >= 2 && orderSeries.length >= 2) {
    const revenuePoints = forecastDailySeries(revenueSeries, HORIZON_DAYS, startDate);
    const orderPoints = forecastDailySeries(orderSeries, HORIZON_DAYS, startDate);
    const sessionPoints = sessionSeries.length >= 2 ? forecastDailySeries(sessionSeries, HORIZON_DAYS, startDate) : [];
    const sessionByDate = new Map(sessionPoints.map((p) => [p.forecastDate, p.predictedValue]));

    for (let i = 0; i < revenuePoints.length; i++) {
      const rev = revenuePoints[i];
      const ord = orderPoints[i];
      const sessions = sessionByDate.get(rev.forecastDate) ?? null;
      out.push({
        forecastDate: rev.forecastDate,
        channel: "all",
        predictedRevenue: rev.predictedValue,
        predictedOrders: ord.predictedValue,
        predictedAov: safeDivide(rev.predictedValue, ord.predictedValue),
        predictedConversionRate: sessions != null ? safeDivide(ord.predictedValue, sessions) : null,
        ciLow: rev.ciLow,
        ciHigh: rev.ciHigh,
        modelUsed: rev.modelUsed,
        r2: rev.r2,
        isReliable: rev.isReliable,
      });
    }
  }

  // --- per-channel-bucket rows: GA4's own tracked revenue/sessions/
  // transactions (the only source with channel-level data at all -- see
  // RevenueReconciliation's header comment on why this differs from the
  // "all" row above).
  const byBucket = new Map<ChannelBucket, Map<string, ChannelSeriesPoint>>();
  for (const bucket of ALL_CHANNEL_BUCKETS) byBucket.set(bucket, new Map());
  for (const r of ga4Rows) {
    const bucket = collapseGA4Channel(r.channel_group);
    const m = byBucket.get(bucket)!;
    const existing = m.get(r.date) ?? { date: r.date, revenue: 0, sessions: 0, transactions: 0 };
    m.set(r.date, {
      date: r.date,
      revenue: existing.revenue + Number(r.revenue),
      sessions: existing.sessions + Number(r.sessions),
      transactions: existing.transactions + Number(r.transactions),
    });
  }

  for (const bucket of ALL_CHANNEL_BUCKETS) {
    const points = [...byBucket.get(bucket)!.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (points.length < 2) continue;
    const revSeries = fillDailyGaps(points.map((p) => ({ date: p.date, value: p.revenue })));
    const txnSeries = fillDailyGaps(points.map((p) => ({ date: p.date, value: p.transactions })));
    const sesSeries = fillDailyGaps(points.map((p) => ({ date: p.date, value: p.sessions })));

    const revPoints = forecastDailySeries(revSeries, HORIZON_DAYS, startDate);
    const txnPoints = forecastDailySeries(txnSeries, HORIZON_DAYS, startDate);
    const sesPoints = forecastDailySeries(sesSeries, HORIZON_DAYS, startDate);

    for (let i = 0; i < revPoints.length; i++) {
      const rev = revPoints[i];
      const txn = txnPoints[i];
      const ses = sesPoints[i];
      out.push({
        forecastDate: rev.forecastDate,
        channel: bucket,
        predictedRevenue: rev.predictedValue,
        predictedOrders: txn.predictedValue, // GA4 transactions, standing in for "orders" at channel level -- see type doc
        predictedAov: safeDivide(rev.predictedValue, txn.predictedValue),
        predictedConversionRate: safeDivide(txn.predictedValue, ses.predictedValue),
        ciLow: rev.ciLow,
        ciHigh: rev.ciHigh,
        modelUsed: rev.modelUsed,
        r2: rev.r2,
        isReliable: rev.isReliable,
      });
    }
  }

  return out;
}

async function upsertAdSpendForecast(rows: ForecastAdSpendRow[]): Promise<void> {
  if (rows.length === 0) return;
  const pool = getPool();
  const cols = ["forecast_date", "platform", "predicted_spend", "ci_low", "ci_high", "model_used", "r2", "is_reliable"] as const;
  const values: unknown[] = [];
  const tuples: string[] = [];
  rows.forEach((r, idx) => {
    const base = idx * cols.length;
    tuples.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(r.forecastDate, r.platform, r.predictedSpend, r.ciLow, r.ciHigh, r.modelUsed, r.r2, r.isReliable);
  });
  await pool.query(
    `insert into forecast_ad_spend (${cols.join(", ")})
     values ${tuples.join(", ")}
     on conflict (forecast_date, platform) do update set
       predicted_spend = excluded.predicted_spend, ci_low = excluded.ci_low, ci_high = excluded.ci_high,
       model_used = excluded.model_used, r2 = excluded.r2, is_reliable = excluded.is_reliable, generated_at = now()`,
    values
  );
}

async function upsertShopifyForecast(rows: ForecastShopifyRow[]): Promise<void> {
  if (rows.length === 0) return;
  const pool = getPool();
  const cols = [
    "forecast_date",
    "channel",
    "predicted_revenue",
    "predicted_orders",
    "predicted_aov",
    "predicted_conversion_rate",
    "ci_low",
    "ci_high",
    "model_used",
    "r2",
    "is_reliable",
  ] as const;
  const values: unknown[] = [];
  const tuples: string[] = [];
  rows.forEach((r, idx) => {
    const base = idx * cols.length;
    tuples.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(
      r.forecastDate,
      r.channel,
      r.predictedRevenue,
      r.predictedOrders,
      r.predictedAov,
      r.predictedConversionRate,
      r.ciLow,
      r.ciHigh,
      r.modelUsed,
      r.r2,
      r.isReliable
    );
  });
  await pool.query(
    `insert into forecast_shopify_performance (${cols.join(", ")})
     values ${tuples.join(", ")}
     on conflict (forecast_date, channel) do update set
       predicted_revenue = excluded.predicted_revenue, predicted_orders = excluded.predicted_orders,
       predicted_aov = excluded.predicted_aov, predicted_conversion_rate = excluded.predicted_conversion_rate,
       ci_low = excluded.ci_low, ci_high = excluded.ci_high, model_used = excluded.model_used,
       r2 = excluded.r2, is_reliable = excluded.is_reliable, generated_at = now()`,
    values
  );
}

async function runForecast(): Promise<{ adSpendRows: number; shopifyRows: number }> {
  const [adSpend, shopify] = await Promise.all([computeAdSpendForecast(), computeShopifyForecast()]);
  // Full replace, not a plain upsert -- the forecast window shifts by a day
  // (or more, e.g. after a fix like this one) on every run, so an
  // upsert-only write leaves the PREVIOUS run's now-out-of-range dates
  // sitting in the table forever (confirmed live: an old run's leftover
  // final day stuck around after a bug fix shifted every date back by one).
  const pool = getPool();
  await Promise.all([pool.query("delete from forecast_ad_spend"), pool.query("delete from forecast_shopify_performance")]);
  await Promise.all([upsertAdSpendForecast(adSpend), upsertShopifyForecast(shopify)]);
  return { adSpendRows: adSpend.length, shopifyRows: shopify.length };
}

// --- context (reconciliation, new-vs-returning) ------------------------------

async function fetchReconciliation(): Promise<RevenueReconciliation | null> {
  const pool = getPool();
  const from = isoDaysAgo(RECONCILIATION_WINDOW_DAYS);
  const to = isoDaysAgo(0);
  const [{ rows: shopifyRows }, { rows: ga4RowsRes }] = await Promise.all([
    pool.query(`select coalesce(sum(total_price),0)::float8 as revenue from fact_shopify_orders where date between $1 and $2`, [from, to]),
    pool.query(`select coalesce(sum(revenue),0)::float8 as revenue from fact_ga4_channel_daily where date between $1 and $2`, [from, to]),
  ]);
  const shopifyRevenue = shopifyRows[0]?.revenue ?? 0;
  const ga4Revenue = ga4RowsRes[0]?.revenue ?? 0;
  if (shopifyRevenue === 0 && ga4Revenue === 0) return null;
  return {
    from,
    to,
    shopifyRevenue,
    ga4Revenue,
    deviationPct: shopifyRevenue > 0 ? Math.abs(ga4Revenue - shopifyRevenue) / shopifyRevenue : null,
  };
}

async function fetchNewVsReturning(): Promise<NewVsReturningBreakdown | null> {
  const pool = getPool();
  const { rows } = await pool.query(`
    with customer_order_seq as (
      select order_id, total_price,
             row_number() over (partition by customer_id order by date, order_id) as seq
      from fact_shopify_orders
      where customer_id is not null
    )
    select
      count(*) filter (where seq = 1)::float8 as new_orders,
      count(*) filter (where seq > 1)::float8 as returning_orders,
      coalesce(sum(total_price) filter (where seq = 1), 0)::float8 as new_revenue,
      coalesce(sum(total_price) filter (where seq > 1), 0)::float8 as returning_revenue
    from customer_order_seq
  `);
  const r = rows[0];
  if (!r || (r.new_orders === 0 && r.returning_orders === 0)) return null;
  const { rows: rangeRows } = await pool.query(`select min(date)::text as from, max(date)::text as to from fact_shopify_orders`);
  return {
    from: rangeRows[0]?.from ?? "",
    to: rangeRows[0]?.to ?? "",
    newCustomerOrders: r.new_orders,
    returningCustomerOrders: r.returning_orders,
    newCustomerRevenue: r.new_revenue,
    returningCustomerRevenue: r.returning_revenue,
  };
}

/** The "checkout funnel" signal surfacing in the numbers -- compares the
 * first vs. last week of the 30-day forecast, spend vs. the "all channel"
 * Shopify revenue row. Flagged when spend is growing meaningfully faster
 * than revenue (a >10 percentage-point gap), not on any growth direction
 * mismatch (a small gap either way is noise, not a funnel problem). */
function computeFunnelLag(adSpend: ForecastAdSpendRow[], shopifyAll: ForecastShopifyRow[]): FunnelLagFlag | null {
  if (adSpend.length === 0 || shopifyAll.length === 0) return null;
  const byDate = <T extends { forecastDate: string }>(rows: T[]) => [...rows].sort((a, b) => a.forecastDate.localeCompare(b.forecastDate));

  const spendByDate = new Map<string, number>();
  for (const r of adSpend) spendByDate.set(r.forecastDate, (spendByDate.get(r.forecastDate) ?? 0) + r.predictedSpend);
  const spendSeries = byDate([...spendByDate.entries()].map(([forecastDate, predictedSpend]) => ({ forecastDate, predictedSpend })));
  const revenueSeries = byDate(shopifyAll);

  if (spendSeries.length < 14 || revenueSeries.length < 14) return null;

  const firstWeekSpend = spendSeries.slice(0, 7).reduce((s, r) => s + r.predictedSpend, 0);
  const lastWeekSpend = spendSeries.slice(-7).reduce((s, r) => s + r.predictedSpend, 0);
  const firstWeekRevenue = revenueSeries.slice(0, 7).reduce((s, r) => s + r.predictedRevenue, 0);
  const lastWeekRevenue = revenueSeries.slice(-7).reduce((s, r) => s + r.predictedRevenue, 0);

  const spendGrowthPct = safeDivide(lastWeekSpend - firstWeekSpend, firstWeekSpend);
  const revenueGrowthPct = safeDivide(lastWeekRevenue - firstWeekRevenue, firstWeekRevenue);

  const flagged = spendGrowthPct != null && revenueGrowthPct != null && spendGrowthPct - revenueGrowthPct > 0.1;

  return { flagged, spendGrowthPct, revenueGrowthPct };
}

// --- routes -------------------------------------------------------------

// POST /predictive-analysis/run -- recomputes and stores both forecasts.
// No true scheduler exists in this app yet (see shared/src/index.ts's
// header comment) -- triggered manually here, and piggybacked onto "Sync
// all" (see App.tsx's handleSyncAll).
predictiveAnalysisRouter.post(
  "/run",
  asyncHandler(async (_req, res) => {
    const result = await runForecast();
    res.json({ ok: true, ...result });
  })
);

// GET /predictive-analysis -- reads the stored forecast; auto-runs once if
// nothing's been computed yet (first-load convenience), same spirit as
// auto-sync-on-load elsewhere in this app.
predictiveAnalysisRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const pool = getPool();
    let [{ rows: adSpendRows }, { rows: shopifyRows }] = await Promise.all([
      pool.query(
        `select forecast_date::text as "forecastDate", platform::text as platform, predicted_spend as "predictedSpend",
                ci_low as "ciLow", ci_high as "ciHigh", model_used as "modelUsed", r2, is_reliable as "isReliable"
         from forecast_ad_spend order by forecast_date asc`
      ),
      pool.query(
        `select forecast_date::text as "forecastDate", channel, predicted_revenue as "predictedRevenue",
                predicted_orders as "predictedOrders", predicted_aov as "predictedAov",
                predicted_conversion_rate as "predictedConversionRate", ci_low as "ciLow", ci_high as "ciHigh",
                model_used as "modelUsed", r2, is_reliable as "isReliable"
         from forecast_shopify_performance order by forecast_date asc`
      ),
    ]);

    if (adSpendRows.length === 0 && shopifyRows.length === 0) {
      await runForecast();
      [{ rows: adSpendRows }, { rows: shopifyRows }] = await Promise.all([
        pool.query(
          `select forecast_date::text as "forecastDate", platform::text as platform, predicted_spend as "predictedSpend",
                  ci_low as "ciLow", ci_high as "ciHigh", model_used as "modelUsed", r2, is_reliable as "isReliable"
           from forecast_ad_spend order by forecast_date asc`
        ),
        pool.query(
          `select forecast_date::text as "forecastDate", channel, predicted_revenue as "predictedRevenue",
                  predicted_orders as "predictedOrders", predicted_aov as "predictedAov",
                  predicted_conversion_rate as "predictedConversionRate", ci_low as "ciLow", ci_high as "ciHigh",
                  model_used as "modelUsed", r2, is_reliable as "isReliable"
           from forecast_shopify_performance order by forecast_date asc`
        ),
      ]);
    }

    const adSpend = adSpendRows as ForecastAdSpendRow[];
    const shopify = shopifyRows as ForecastShopifyRow[];
    const [reconciliation, newVsReturning] = await Promise.all([fetchReconciliation(), fetchNewVsReturning()]);
    const funnelLag = computeFunnelLag(
      adSpend,
      shopify.filter((r) => r.channel === "all")
    );

    const response: PredictiveAnalysisResponse = {
      generatedAt: new Date().toISOString(),
      adSpend,
      shopify,
      reconciliation,
      newVsReturning,
      funnelLag,
    };
    res.json(response);
  })
);
