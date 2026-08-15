import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { getSupabase } from "./db/supabase";
import type { HealthStatus } from "@fig/shared";

const app = express();
app.use(cors());
app.use(express.json());

function nowIST(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).replace(" ", "T");
}

app.get("/health", (_req, res) => {
  const body: HealthStatus = { ok: true, service: "fig-ads-server", time: nowIST() };
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
    const { error: pingError } = await supabase.from("_fig_healthcheck_probe").select("*").limit(1);
    // A "relation does not exist" error still proves we reached Postgres and
    // authenticated correctly — that's a successful connectivity check pre-migrations.
    if (pingError && !/does not exist/i.test(pingError.message)) {
      return res.status(500).json({ ok: false, reason: pingError.message });
    }
    return res.json({ ok: true, time: nowIST() });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: (err as Error).message });
  }
});

app.listen(env.port, () => {
  console.log(`[fig-ads-server] listening on :${env.port} (${env.nodeEnv}, tz=${env.tz})`);
});
