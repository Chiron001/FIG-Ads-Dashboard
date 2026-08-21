import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { getSupabase } from "./db/supabase";
import { metricsRouter } from "./routes/metrics";
import { syncRouter } from "./routes/sync";
import { shopifyRouter } from "./routes/shopify";
import { shopifyOauthRouter } from "./routes/shopifyOauth";
import { ga4Router } from "./routes/ga4";
import { predictiveAnalysisRouter } from "./routes/predictiveAnalysis";
import { campaignForecastRouter } from "./routes/campaignForecast";
import { statsRouter } from "./routes/stats";
import { metaSkuAttributionRouter } from "./routes/metaSkuAttribution";
import { googleSkuAttributionRouter } from "./routes/googleSkuAttribution";
import { metaCreativePerformanceRouter } from "./routes/metaCreativePerformance";
import { settingsRouter } from "./routes/settings";
import { projectionRouter } from "./routes/projection";
import { aiRouter } from "./routes/ai";
import { authRouter } from "./routes/auth";
import { siteAuthMiddleware } from "./middleware/siteAuth";
import type { AppConfig, HealthStatus } from "@fig/shared";

const app = express();
app.use(cors());
app.use(express.json());
// Whole-site shared-password gate -- see middleware/siteAuth.ts. Mounted
// before every router below (including /auth itself, which the middleware
// explicitly exempts by path) so nothing is reachable without it.
app.use(siteAuthMiddleware);
app.use("/auth", authRouter);

app.use("/metrics", metricsRouter);
app.use("/sync", syncRouter);
// One-time OAuth handshake to obtain SHOPIFY_ADMIN_ACCESS_TOKEN -- see
// routes/shopifyOauth.ts. Separate from shopifyRouter (which serves the
// actual data endpoints) so the distinction is obvious from the router
// list alone: this one is a setup tool, not part of the data API surface.
// Mounted before the broader /shopify prefix so its more specific path
// always wins the match, regardless of route order inside shopifyRouter.
app.use("/shopify/oauth", shopifyOauthRouter);
app.use("/shopify", shopifyRouter);
// GA4 channel/session cross-check -- stored history (fact_ga4_channel_daily),
// unlike Shopify's own live-only ShopifyQL session queries. See routes/ga4.ts.
app.use("/ga4", ga4Router);
// Ad spend + Shopify revenue/orders/AOV/CVR forecasts -- see
// routes/predictiveAnalysis.ts.
app.use("/predictive-analysis", predictiveAnalysisRouter);
// Per-campaign ad spend/revenue/ROAS forecast for the Google Ads/Meta Ads
// "Predictive Analysis" sub-pages -- read-only view over the same
// forecast_ad_spend table/recompute action as the line above. See
// routes/campaignForecast.ts.
app.use("/campaign-forecast", campaignForecastRouter);
// Meta ad spend cross-referenced against Shopify per-SKU revenue -- see
// routes/metaSkuAttribution.ts. Its own top-level path (not nested under
// /shopify or /metrics) since it genuinely reads from both.
app.use("/meta-sku-attribution", metaSkuAttributionRouter);
// Google's exact counterpart -- see routes/googleSkuAttribution.ts's header
// comment for why this one doesn't need a name-tag guess.
app.use("/google-sku-attribution", googleSkuAttributionRouter);
// Second Meta-only lens on the same ad-name-tagging idea, this time parsing
// the full creative naming convention ("$...$" wrapper) -- see
// routes/metaCreativePerformance.ts and util/creativeTag.ts.
app.use("/meta-creative-performance", metaCreativePerformanceRouter);
app.use("/stats", statsRouter);
app.use("/settings", settingsRouter);
app.use("/projection", projectionRouter);
// AI home page's "ask anything" box -- see routes/ai.ts.
app.use("/ai", aiRouter);

function nowIST(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).replace(" ", "T");
}

app.get("/health", (_req, res) => {
  const body: HealthStatus = { ok: true, service: "fig-ads-server", time: nowIST() };
  res.json(body);
});

// Starting-point defaults for the campaign table's Break-even ROAS/Profit/
// Verdict math -- the UI reads this once and lets the analyst override
// live from there (no localStorage, so overrides don't persist reloads).
app.get("/config", (_req, res) => {
  const body: AppConfig = { grossMargin: env.grossMargin, targetRoas: env.targetRoas };
  res.json(body);
});

// Confirms Supabase connectivity once SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are set in .env. Returns ok:false with a clear reason if not configured yet,
// rather than crashing the whole server (Phase 1 scaffold should boot even
// before Supabase is provisioned).
app.get("/health/db", async (_req, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({
      ok: false,
      reason: "Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env)",
    });
  }

  try {
    // sync_log is one of the two tables db/migrations/0001_init.sql creates,
    // so a successful (even zero-row) count proves both connectivity and
    // that migrations have been applied.
    const { error: pingError } = await supabase.from("sync_log").select("*", { count: "exact", head: true });
    if (pingError) {
      // PGRST205 = PostgREST can't find the table in its schema cache — the
      // connection itself is fine, migrations just haven't run yet.
      const reason =
        pingError.code === "PGRST205"
          ? "Connected, but sync_log doesn't exist yet — run `npm run migrate --workspace server`."
          : pingError.message;
      return res.status(500).json({ ok: false, reason });
    }
    return res.json({ ok: true, time: nowIST() });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: (err as Error).message });
  }
});

// Catches errors forwarded by asyncHandler (see util/asyncHandler.ts) --
// without this, an async route that throws just hangs the request in
// Express 4 rather than returning a clean error response.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(env.port, () => {
  console.log(`[fig-ads-server] listening on :${env.port} (${env.nodeEnv}, tz=${env.tz})`);
});
