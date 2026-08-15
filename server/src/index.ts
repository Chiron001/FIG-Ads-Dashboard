import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { getSupabase } from "./db/supabase";
import { metricsRouter } from "./routes/metrics";
import { syncRouter } from "./routes/sync";
import { shopifyRouter } from "./routes/shopify";
import { shopifyOauthRouter } from "./routes/shopifyOauth";
import { statsRouter } from "./routes/stats";
import type { AppConfig, HealthStatus } from "@fig/shared";

const app = express();
app.use(cors());
app.use(express.json());

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
app.use("/stats", statsRouter);

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
