// Canonical types shared between /server and /web.
//
// These mirror the fact_ad_performance / sync_log schema in
// /db/migrations/0001_init.sql exactly. Raw platform fields never reach the
// UI — every connector normalizes into CanonicalRow before it's stored.

export type Platform = "google" | "meta" | "amazon" | "myntra";

/** Fixed display/processing order — also used as the categorical color-slot
 * assignment order in the UI (dataviz skill: assign hues in fixed order,
 * never cycled). */
export const ALL_PLATFORMS: Platform[] = ["google", "meta", "amazon", "myntra"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
  amazon: "Amazon Ads",
  myntra: "Myntra Ads",
};

export interface HealthStatus {
  ok: boolean;
  service: string;
  time: string; // ISO timestamp, IST
}

// --- fact_ad_performance --------------------------------------------------

/**
 * One row of the canonical fact table. `date` is always IST
 * (Asia/Kolkata), regardless of the source platform's reporting timezone —
 * converted in the normalization layer before storage.
 */
export interface CanonicalRow {
  id: string; // uuid
  platform: Platform;
  campaignId: string;
  campaignName: string | null;
  /** Meta = adset, Amazon = ad group (report-type-prefixed, e.g. "sp:123"), Google = ad group, Myntra = usually null. */
  adGroupId: string | null;
  adGroupName: string | null;
  /** ISO date string (YYYY-MM-DD), IST. */
  date: string;
  spend: number; // INR
  impressions: number;
  clicks: number;
  conversions: number; // orders
  revenue: number; // INR
  /** Source attribution window, e.g. meta_7d_click, amazon_14d, google_dda, myntra_as_reported. */
  attributionWindow: string;
  /** Original platform row, kept for debugging. */
  raw: Record<string, unknown> | null;
  ingestedAt: string; // ISO timestamptz
}

/** Shape a connector emits before insertion — id/ingestedAt are DB-assigned. */
export type CanonicalRowInput = Omit<CanonicalRow, "id" | "ingestedAt">;

// --- sync_log --------------------------------------------------------------

export type SyncStatus = "success" | "partial" | "error";

export interface SyncLogEntry {
  id: string;
  platform: Platform;
  runAt: string; // ISO timestamptz
  status: SyncStatus;
  rows: number;
  error: string | null;
}

// --- connector interface ----------------------------------------------------

/** A raw row as returned by a platform's API/export, before normalization. */
export type RawRow = Record<string, unknown>;

export interface AdsConnector {
  platform: Exclude<Platform, "myntra">; // Myntra is CSV-ingest only, not a live connector.
  authenticate(): Promise<void>;
  fetchRaw(from: string, to: string): Promise<RawRow[]>;
  normalize(rows: RawRow[]): CanonicalRowInput[];
}

// --- derived metrics --------------------------------------------------------
//
// Computed on demand (API/UI), never stored. Each returns null rather than
// NaN/Infinity when the denominator is zero, so the UI can render "—"
// instead of a garbage number.

export interface DerivedMetrics {
  ctr: number | null; // clicks / impressions
  cpc: number | null; // spend / clicks
  cpm: number | null; // spend / impressions * 1000
  roas: number | null; // revenue / spend
  acos: number | null; // spend / revenue
  cvr: number | null; // conversions / clicks
}

function safeDivide(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function computeDerivedMetrics(row: {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}): DerivedMetrics {
  return {
    ctr: safeDivide(row.clicks, row.impressions),
    cpc: safeDivide(row.spend, row.clicks),
    cpm: safeDivide(row.spend, row.impressions) !== null ? (row.spend / row.impressions) * 1000 : null,
    roas: safeDivide(row.revenue, row.spend),
    acos: safeDivide(row.spend, row.revenue),
    cvr: safeDivide(row.conversions, row.clicks),
  };
}

// --- API response shapes -----------------------------------------------------
//
// Shared between server route handlers and web fetch calls so the two
// never drift. Filled in as Phase 6 (API) is built; declared here now so
// Phase 4/5 connector and normalization code has a stable target shape.

export interface PlatformTotals extends DerivedMetrics {
  platform: Platform;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export interface MetricsSummaryResponse {
  from: string; // ISO date
  to: string; // ISO date
  platforms: PlatformTotals[];
  /** Sum across all requested platforms. Always labeled non-attributed in the UI — see spec §3/§6. */
  blended: Omit<PlatformTotals, "platform"> & { label: "blended, non-attributed" };
}

export type TimeseriesMetric = "spend" | "impressions" | "clicks" | "conversions" | "revenue" | keyof DerivedMetrics;

/** One row per date; one key per requested platform holding that day's value for `metric`. */
export type TimeseriesPoint = { date: string } & Partial<Record<Platform, number | null>>;

export interface MetricsTimeseriesResponse {
  from: string;
  to: string;
  metric: TimeseriesMetric;
  platforms: Platform[];
  points: TimeseriesPoint[];
}

export interface CampaignRow extends DerivedMetrics {
  campaignId: string;
  campaignName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export interface MetricsCampaignsResponse {
  from: string;
  to: string;
  platform: Platform;
  campaigns: CampaignRow[];
}

export interface PlatformSyncStatus {
  platform: Platform;
  /** false when the platform has no connector wired up at all (Amazon on hold) or CSV-only by design (Myntra). */
  connected: boolean;
  lastSync: SyncLogEntry | null;
}

export interface SyncStatusResponse {
  platforms: PlatformSyncStatus[];
}
