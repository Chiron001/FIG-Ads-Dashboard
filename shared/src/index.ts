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
  /** Google Ads only (Search-eligible campaign types) -- search_impression_share. Null elsewhere/unavailable. */
  searchImpressionShare: number | null;
  /** Google Ads only -- search_budget_lost_impression_share. Null elsewhere/unavailable. */
  searchBudgetLostImpressionShare: number | null;
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

/** One entry in a platform's full campaign roster -- independent of any
 * date range, so it includes paused/zero-activity campaigns that
 * fact_ad_performance (activity-only) would never surface. `status` is the
 * platform's own raw string (Google: ENABLED/PAUSED; Meta: effective_status
 * values like ACTIVE/PAUSED/ARCHIVED) -- not normalized into a shared enum,
 * see db/migrations/0002_dim_campaign.sql. */
export interface CampaignRosterEntry {
  campaignId: string;
  campaignName: string | null;
  status: string | null;
}

export interface AdsConnector {
  platform: Exclude<Platform, "myntra">; // Myntra is CSV-ingest only, not a live connector.
  authenticate(): Promise<void>;
  fetchRaw(from: string, to: string): Promise<RawRow[]>;
  normalize(rows: RawRow[]): CanonicalRowInput[];
  /** Full campaign list (any status except removed/deleted), independent of date range. */
  fetchCampaignRoster(): Promise<CampaignRosterEntry[]>;
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
  cpa: number | null; // spend / conversions ("cost per order/acquisition")
  aov: number | null; // revenue / conversions
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
    cpa: safeDivide(row.spend, row.conversions),
    aov: safeDivide(row.revenue, row.conversions),
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
  /** Raw platform status string -- see CampaignRosterEntry. Null for legacy rows predating dim_campaign. */
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  /** Google Search campaigns only; null elsewhere/unavailable. */
  searchImpressionShare: number | null;
  searchBudgetLostImpressionShare: number | null;
  /** (ROAS_current - ROAS_prior) / ROAS_prior for the equal-length period immediately preceding `from`. Null if either period has no spend for this campaign. */
  roasDeltaWoW: number | null;
}

export interface MetricsCampaignsResponse {
  from: string;
  to: string;
  platform: Platform;
  campaigns: CampaignRow[];
}

// --- app-level config (gross margin / target ROAS) ---------------------------
//
// Drives Break-even ROAS, Profit, and Verdict on the campaign table. Server
// default comes from .env (GROSS_MARGIN / TARGET_ROAS); the UI reads this
// once as a starting point and lets the analyst override live, per spec --
// no localStorage, so overrides reset on reload.
export interface AppConfig {
  grossMargin: number; // fraction, e.g. 0.60
  targetRoas: number; // e.g. 4
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
