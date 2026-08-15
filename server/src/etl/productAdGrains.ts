import { getPool } from "../db/pool";
import type { ProductPerformanceInput, AdPerformanceInput } from "./grainTypes";
import { GoogleAdsConnector } from "../connectors/google";
import { MetaAdsConnector } from "../connectors/meta";

// Product-level and ad-level spend -- two separate breakdowns of the same
// fact_ad_performance campaign spend, each in its own table, never summed
// with each other or with the campaign grain. Google (Shopping/PMax feed +
// ad_group_ad) and Meta (catalog/pixel product_id breakdown + level=ad
// insights) both write into these same two tables. See
// db/migrations/0005_google_product_ad_grain.sql,
// db/migrations/0006_generalize_product_ad_grain.sql, and the build spec's
// "Critical modeling rule."

const BATCH_SIZE = 500; // keeps param count well under Postgres's ~65535 limit per statement

const PRODUCT_COLUMNS = [
  "platform",
  "campaign_id",
  "campaign_name",
  "product_item_id",
  "product_title",
  "product_brand",
  "product_type_l1",
  "product_type_l2",
  "product_type_l3",
  "product_channel",
  "date",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "raw",
] as const;

/** Collapses rows sharing the same (campaignId, productItemId, date) into
 * one, summing the additive metrics. Required before upsert: the unique
 * index is on exactly that triple, and Postgres's ON CONFLICT DO UPDATE
 * errors ("cannot affect row a second time") if the SAME conflict key
 * appears twice within one INSERT's VALUES list -- confirmed live on Meta,
 * where the product_id breakdown is queried at level=ad, so the same
 * product shown via two different ads in one campaign on one day produces
 * two raw rows for the same (campaign, product, date). Google's
 * shopping_performance_view has no such collision (no ad dimension), so
 * this is a no-op there, but it's applied unconditionally rather than
 * gated per-platform -- cheap, and correct either way. */
export function collapseProductDuplicates(rows: ProductPerformanceInput[]): ProductPerformanceInput[] {
  const byKey = new Map<string, ProductPerformanceInput>();
  for (const row of rows) {
    const key = `${row.campaignId}|${row.productItemId}|${row.date}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
      continue;
    }
    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.conversions += row.conversions;
    existing.revenue += row.revenue;
    // Descriptive fields (title/brand/type) should agree across duplicates
    // for the same product -- keep whichever's already there, fill gaps.
    existing.productTitle ??= row.productTitle;
    existing.productBrand ??= row.productBrand;
    existing.productTypeL1 ??= row.productTypeL1;
    existing.productTypeL2 ??= row.productTypeL2;
    existing.productTypeL3 ??= row.productTypeL3;
    existing.productChannel ??= row.productChannel;
  }
  return [...byKey.values()];
}

export async function upsertProductRows(platform: "google" | "meta", inputRows: ProductPerformanceInput[]): Promise<number> {
  const rows = collapseProductDuplicates(inputRows);
  if (rows.length === 0) return 0;
  const pool = getPool();
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];

    batch.forEach((row, idx) => {
      const base = idx * PRODUCT_COLUMNS.length;
      const placeholders = PRODUCT_COLUMNS.map((_, j) => `$${base + j + 1}`).join(", ");
      tuples.push(`(${placeholders})`);
      values.push(
        platform,
        row.campaignId,
        row.campaignName,
        row.productItemId,
        row.productTitle,
        row.productBrand,
        row.productTypeL1,
        row.productTypeL2,
        row.productTypeL3,
        row.productChannel,
        row.date,
        row.spend,
        row.impressions,
        row.clicks,
        row.conversions,
        row.revenue,
        JSON.stringify(row.raw)
      );
    });

    const sql = `
      INSERT INTO fact_shopping_product_performance (${PRODUCT_COLUMNS.join(", ")})
      VALUES ${tuples.join(", ")}
      ON CONFLICT (platform, campaign_id, product_item_id, date)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        product_title = EXCLUDED.product_title,
        product_brand = EXCLUDED.product_brand,
        product_type_l1 = EXCLUDED.product_type_l1,
        product_type_l2 = EXCLUDED.product_type_l2,
        product_type_l3 = EXCLUDED.product_type_l3,
        product_channel = EXCLUDED.product_channel,
        spend = EXCLUDED.spend,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        conversions = EXCLUDED.conversions,
        revenue = EXCLUDED.revenue,
        raw = EXCLUDED.raw,
        ingested_at = now()
    `;
    await pool.query(sql, values);
    written += batch.length;
  }

  return written;
}

const AD_COLUMNS = [
  "platform",
  "campaign_id",
  "campaign_name",
  "ad_group_id",
  "ad_group_name",
  "ad_id",
  "ad_name",
  "ad_type",
  "ad_status",
  "date",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "raw",
] as const;

export async function upsertAdRows(platform: "google" | "meta", rows: AdPerformanceInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const pool = getPool();
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const tuples: string[] = [];

    batch.forEach((row, idx) => {
      const base = idx * AD_COLUMNS.length;
      const placeholders = AD_COLUMNS.map((_, j) => `$${base + j + 1}`).join(", ");
      tuples.push(`(${placeholders})`);
      values.push(
        platform,
        row.campaignId,
        row.campaignName,
        row.adGroupId,
        row.adGroupName,
        row.adId,
        row.adName,
        row.adType,
        row.adStatus,
        row.date,
        row.spend,
        row.impressions,
        row.clicks,
        row.conversions,
        row.revenue,
        JSON.stringify(row.raw)
      );
    });

    const sql = `
      INSERT INTO fact_ad_creative_performance (${AD_COLUMNS.join(", ")})
      VALUES ${tuples.join(", ")}
      ON CONFLICT (platform, campaign_id, ad_group_id, ad_id, date)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        ad_group_name = EXCLUDED.ad_group_name,
        ad_name = EXCLUDED.ad_name,
        ad_type = EXCLUDED.ad_type,
        ad_status = EXCLUDED.ad_status,
        spend = EXCLUDED.spend,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        conversions = EXCLUDED.conversions,
        revenue = EXCLUDED.revenue,
        raw = EXCLUDED.raw,
        ingested_at = now()
    `;
    await pool.query(sql, values);
    written += batch.length;
  }

  return written;
}

export interface GrainSyncResult {
  products: { status: "success" | "error"; rows: number; error: string | null };
  ads: { status: "success" | "error"; rows: number; error: string | null };
}

/** Pulls product- and ad-level Google spend for `from`..`to` and upserts
 * each into its own table. Called from runSync() alongside the main
 * campaign-grain sync (spec §3: "same schedule + rolling 3-day re-pull as
 * campaign data"), on the SAME authenticated connector instance -- no
 * separate auth/token-refresh. Each grain is independently try/caught so a
 * failure in one (e.g. a Shopping-feed permission quirk) doesn't take down
 * the other or the caller's main campaign sync. */
export async function runGoogleGrainSync(connector: GoogleAdsConnector, from: string, to: string): Promise<GrainSyncResult> {
  const result: GrainSyncResult = {
    products: { status: "success", rows: 0, error: null },
    ads: { status: "success", rows: 0, error: null },
  };

  try {
    const raw = await connector.fetchProductPerformance(from, to);
    const rows = connector.normalizeProductPerformance(raw);
    result.products.rows = await upsertProductRows("google", rows);
  } catch (err) {
    result.products = { status: "error", rows: 0, error: (err as Error).message };
    console.warn("[google grain sync] product performance failed (campaign sync still wrote fine):", err);
  }

  try {
    const raw = await connector.fetchAdPerformance(from, to);
    const rows = connector.normalizeAdPerformance(raw);
    result.ads.rows = await upsertAdRows("google", rows);
  } catch (err) {
    result.ads = { status: "error", rows: 0, error: (err as Error).message };
    console.warn("[google grain sync] ad performance failed (campaign sync still wrote fine):", err);
  }

  return result;
}

/** Same idea as runGoogleGrainSync, for Meta. Meta's product grain
 * (Insights breakdowns=product_id) is flakier over long date ranges
 * combined with time_increment=1 (observed live: generic "Service
 * temporarily unavailable" errors) -- MetaAdsConnector.fetchProductPerformance
 * chunks internally, so this function doesn't need to. */
export async function runMetaGrainSync(connector: MetaAdsConnector, from: string, to: string): Promise<GrainSyncResult> {
  const result: GrainSyncResult = {
    products: { status: "success", rows: 0, error: null },
    ads: { status: "success", rows: 0, error: null },
  };

  try {
    const raw = await connector.fetchProductPerformance(from, to);
    const rows = connector.normalizeProductPerformance(raw);
    result.products.rows = await upsertProductRows("meta", rows);
  } catch (err) {
    result.products = { status: "error", rows: 0, error: (err as Error).message };
    console.warn("[meta grain sync] product performance failed (campaign sync still wrote fine):", err);
  }

  try {
    const raw = await connector.fetchAdPerformance(from, to);
    const rows = connector.normalizeAdPerformance(raw);
    result.ads.rows = await upsertAdRows("meta", rows);
  } catch (err) {
    result.ads = { status: "error", rows: 0, error: (err as Error).message };
    console.warn("[meta grain sync] ad performance failed (campaign sync still wrote fine):", err);
  }

  return result;
}
