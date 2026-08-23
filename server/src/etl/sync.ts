import { getPool } from "../db/pool";
import { GoogleAdsConnector } from "../connectors/google";
import { MetaAdsConnector } from "../connectors/meta";
import { AmazonAdsConnector } from "../connectors/amazon";
import { runGoogleGrainSync, runMetaGrainSync } from "./productAdGrains";
import type { AdsConnector, CampaignRosterEntry, CanonicalRowInput, Platform } from "@fig/shared";

// Myntra intentionally omitted -- CSV-ingest only by design, see README.
// runSync() below returns a clean "not implemented" sync_log entry for it
// rather than crashing, so /sync/status and the dashboard can still show
// it gracefully as not-yet-connected.
const CONNECTORS: Partial<Record<Platform, () => AdsConnector>> = {
  google: () => new GoogleAdsConnector(),
  meta: () => new MetaAdsConnector(),
  amazon: () => new AmazonAdsConnector(),
};

const UPSERT_COLUMNS = [
  "platform",
  "campaign_id",
  "campaign_name",
  "ad_group_id",
  "ad_group_name",
  "date",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "attribution_window",
  "search_impression_share",
  "search_budget_lost_impression_share",
  "raw",
] as const;

const BATCH_SIZE = 500; // keeps param count well under Postgres's ~65535 limit per statement

async function upsertRows(rows: CanonicalRowInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const pool = getPool();
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];

    batch.forEach((row, idx) => {
      const base = idx * UPSERT_COLUMNS.length;
      const placeholders = UPSERT_COLUMNS.map((_, j) => `$${base + j + 1}`).join(", ");
      tuples.push(`(${placeholders})`);
      values.push(
        row.platform,
        row.campaignId,
        row.campaignName,
        row.adGroupId,
        row.adGroupName,
        row.date,
        row.spend,
        row.impressions,
        row.clicks,
        row.conversions,
        row.revenue,
        row.attributionWindow,
        row.searchImpressionShare,
        row.searchBudgetLostImpressionShare,
        row.raw ? JSON.stringify(row.raw) : null
      );
    });

    // Conflict target must repeat the exact expression from the unique
    // index in db/migrations/0001_init.sql (coalesce(ad_group_id, '')) --
    // Postgres matches ON CONFLICT expressions structurally against the
    // index definition, not just by column list.
    const sql = `
      INSERT INTO fact_ad_performance (${UPSERT_COLUMNS.join(", ")})
      VALUES ${tuples.join(", ")}
      ON CONFLICT (platform, campaign_id, coalesce(ad_group_id, ''), date, attribution_window)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        ad_group_name = EXCLUDED.ad_group_name,
        spend = EXCLUDED.spend,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        conversions = EXCLUDED.conversions,
        revenue = EXCLUDED.revenue,
        search_impression_share = EXCLUDED.search_impression_share,
        search_budget_lost_impression_share = EXCLUDED.search_budget_lost_impression_share,
        raw = EXCLUDED.raw,
        ingested_at = now()
    `;
    await pool.query(sql, values);
    written += batch.length;
  }

  return written;
}

async function upsertCampaignRoster(platform: Platform, entries: CampaignRosterEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const pool = getPool();
  const values: unknown[] = [];
  const tuples: string[] = [];

  entries.forEach((entry, idx) => {
    const base = idx * 4;
    tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    values.push(platform, entry.campaignId, entry.campaignName, entry.status);
  });

  await pool.query(
    `
      INSERT INTO dim_campaign (platform, campaign_id, campaign_name, status)
      VALUES ${tuples.join(", ")}
      ON CONFLICT (platform, campaign_id)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        status = EXCLUDED.status,
        updated_at = now()
    `,
    values
  );
}

export interface SyncResult {
  platform: Platform;
  status: "success" | "partial" | "error";
  rows: number;
  error: string | null;
}

async function logSync(result: SyncResult): Promise<void> {
  const pool = getPool();
  await pool.query(`insert into sync_log (platform, status, rows, error) values ($1, $2, $3, $4)`, [
    result.platform,
    result.status,
    result.rows,
    result.error,
  ]);
}

/** Pulls `from`..`to` from the given platform's live connector, normalizes,
 * upserts into fact_ad_performance, and records a sync_log row either way. */
export async function runSync(platform: Platform, from: string, to: string): Promise<SyncResult> {
  const factory = CONNECTORS[platform];

  if (!factory) {
    const result: SyncResult = {
      platform,
      status: "error",
      rows: 0,
      error:
        platform === "myntra"
          ? "Myntra has no live connector by design -- use POST /ingest/myntra (CSV upload) instead."
          : `${platform} connector is on hold, not yet implemented.`,
    };
    await logSync(result);
    return result;
  }

  try {
    const connector = factory();
    await connector.authenticate();
    const raw = await connector.fetchRaw(from, to);
    const rows = connector.normalize(raw);
    const written = await upsertRows(rows);

    // Roster refresh is independent of the date-range fetch above and
    // shouldn't fail the whole sync if it errors -- performance data
    // landing successfully matters more than the roster being fresh this
    // particular run (it'll catch up next sync).
    try {
      const roster = await connector.fetchCampaignRoster();
      await upsertCampaignRoster(platform, roster);
    } catch (rosterErr) {
      console.warn(`[sync] ${platform} campaign roster refresh failed (fact data still wrote fine):`, rosterErr);
    }

    // Product-level and ad-level grain -- Google and Meta, on the same
    // authenticated connector, same schedule as the campaign-grain sync
    // above. Independently try/caught inside run*GrainSync so neither
    // grain's failure affects the other or this main sync result.
    if (platform === "google" && connector instanceof GoogleAdsConnector) {
      const grainResult = await runGoogleGrainSync(connector, from, to);
      console.log(
        `[sync] google product grain: ${grainResult.products.status} (${grainResult.products.rows} rows)` +
          (grainResult.products.error ? ` -- ${grainResult.products.error}` : "") +
          `; ad grain: ${grainResult.ads.status} (${grainResult.ads.rows} rows)` +
          (grainResult.ads.error ? ` -- ${grainResult.ads.error}` : "")
      );
    }
    if (platform === "meta" && connector instanceof MetaAdsConnector) {
      const grainResult = await runMetaGrainSync(connector, from, to);
      console.log(
        `[sync] meta product grain: ${grainResult.products.status} (${grainResult.products.rows} rows)` +
          (grainResult.products.error ? ` -- ${grainResult.products.error}` : "") +
          `; ad grain: ${grainResult.ads.status} (${grainResult.ads.rows} rows)` +
          (grainResult.ads.error ? ` -- ${grainResult.ads.error}` : "")
      );
    }

    const result: SyncResult = { platform, status: "success", rows: written, error: null };
    await logSync(result);
    return result;
  } catch (err) {
    const result: SyncResult = { platform, status: "error", rows: 0, error: (err as Error).message };
    await logSync(result);
    return result;
  }
}
