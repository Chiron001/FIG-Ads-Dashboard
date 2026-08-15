import { Router } from "express";
import { getPool } from "../db/pool";
import { runSync } from "../etl/sync";
import { asyncHandler } from "../util/asyncHandler";
import { ALL_PLATFORMS } from "@fig/shared";
import type { Platform, PlatformSyncStatus, SyncStatusResponse, SyncLogEntry } from "@fig/shared";
import { env } from "../config/env";

export const syncRouter = Router();

function isConnected(platform: Platform): boolean {
  if (platform === "google") return Boolean(env.google.clientId && env.google.refreshToken && env.google.customerId);
  if (platform === "meta") return Boolean(env.meta.accessToken && env.meta.adAccountId);
  return false; // amazon on hold; myntra is CSV-only by design, never "connected" in the live-API sense
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// GET /sync/status -- last sync attempt + connection state per platform.
syncRouter.get("/status", asyncHandler(async (_req, res) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `select distinct on (platform)
       id::text as id,
       platform::text as platform,
       status,
       rows,
       error,
       run_at as "runAt"
     from sync_log
     order by platform, run_at desc`
  );
  const byPlatform = new Map(rows.map((r) => [r.platform as Platform, r]));

  const platforms: PlatformSyncStatus[] = ALL_PLATFORMS.map((platform) => {
    const row = byPlatform.get(platform);
    const lastSync: SyncLogEntry | null = row
      ? {
          id: row.id,
          platform,
          runAt: row.runAt instanceof Date ? row.runAt.toISOString() : row.runAt,
          status: row.status,
          rows: row.rows,
          error: row.error,
        }
      : null;
    return { platform, connected: isConnected(platform), lastSync };
  });

  const response: SyncStatusResponse = { platforms };
  res.json(response);
}));

// POST /sync/:platform -- manual trigger, body: { from?, to? } (YYYY-MM-DD), defaults to last 7 days.
syncRouter.post("/:platform", asyncHandler(async (req, res) => {
  const platform = req.params.platform as Platform;
  if (!(ALL_PLATFORMS as string[]).includes(platform)) {
    return res.status(400).json({ error: `unknown platform: ${platform}` });
  }

  const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
  const from = typeof body.from === "string" ? body.from : isoDaysAgo(7);
  const to = typeof body.to === "string" ? body.to : isoDaysAgo(0);

  const result = await runSync(platform, from, to);
  const statusCode = result.status === "success" ? 200 : 502;
  res.status(statusCode).json(result);
}));
