import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { runGA4Sync } from "../etl/ga4Sync";
import { env } from "../config/env";
import type { Ga4Status, SyncLogEntry } from "@fig/shared";

export const ga4Router = Router();

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// GET /ga4/status
ga4Router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `select id::text as id, status, rows, error, run_at as "runAt"
       from sync_log where platform = 'ga4' order by run_at desc limit 1`
    );
    const row = rows[0];
    const lastSync: SyncLogEntry | null = row
      ? {
          id: row.id,
          platform: "ga4",
          runAt: row.runAt instanceof Date ? row.runAt.toISOString() : row.runAt,
          status: row.status,
          rows: row.rows,
          error: row.error,
        }
      : null;

    const body: Ga4Status = { connected: Boolean(env.ga4.propertyId && env.ga4.serviceAccountKey), lastSync };
    res.json(body);
  })
);

// POST /ga4/sync -- body: { from?, to? } (YYYY-MM-DD), defaults to last 90
// days -- wider than the ad-platform/Shopify default (7 days) since GA4
// history is what the forecast trains on and a shallow sync would starve it.
ga4Router.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
    const from = typeof body.from === "string" ? body.from : isoDaysAgo(90);
    const to = typeof body.to === "string" ? body.to : isoDaysAgo(0);
    const result = await runGA4Sync(from, to);
    res.status(result.status === "success" ? 200 : 502).json(result);
  })
);
