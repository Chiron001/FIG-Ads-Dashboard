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
  /** "shopify" isn't in Platform (it's not an ad platform -- see shopify.ts types below) but shares this same sync_log row shape. */
  platform: Platform | "shopify";
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

// --- statistics layer (spec: /server/stats/) --------------------------------
//
// Sample-size gating is mandatory (spec §0/§8): every inferential value
// carries a confidence tag, and "insufficient" means the UI renders "—",
// never the raw number.

export type StatsConfidence = "high" | "medium" | "low" | "insufficient";
export type ReliabilityLabel = "Stable" | "Variable" | "Volatile";

export interface CampaignReliability {
  /** Coefficient of variation on daily ROAS -- null if n<2 or mean=0. */
  cv: number | null;
  label: ReliabilityLabel | null;
}

export interface ConfidenceInterval {
  low: number;
  high: number;
  confidence: StatsConfidence;
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
  /** CV of daily ROAS -- "is this 5x dependable or a coin-flip" (spec §1). */
  reliability: CampaignReliability;
  /** Right-skew flags (spec §1: mean > 1.5x median) -- "trust the median, not the mean." */
  roasSkewed: boolean;
  cpaSkewed: boolean;
  /** Wilson 95% CI on aggregate CVR (spec §3a), null only if clicks=0. The confidence tag here IS the "confidence pill next to ROAS" from spec §3c. */
  cvrCI: ConfidenceInterval | null;
  /** Return on the next rupee of spend vs the prior equal-length period (spec §6c). Null if spend didn't increase. */
  marginalRoas: number | null;
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

// --- Shopify (ground-truth orders/products, not an ad platform) -------------
//
// No spend/impressions/clicks/campaigns -- deliberately not shoehorned into
// CanonicalRow/CampaignRow/Platform. Own tables (db/migrations/0004_shopify.sql),
// own routes (/shopify/*), own section in the UI. Purpose: cross-check what
// each ad platform *claims* as attributed revenue against what actually
// happened, plus product-level detail no ad platform's fact rows have.

export interface ShopifyOrderSummary {
  orders: number;
  revenue: number;
  aov: number | null; // null if orders = 0
  discounts: number;
  unitsSold: number;
  /** True site-wide session total for the range (Shopify Analytics, live --
   * not stored, see db/migrations/0007). Null if the ShopifyQL call failed
   * (e.g. a plan/permission restriction) -- the rest of the summary still
   * renders, this one field alone drops to "—". */
  sessions: number | null;
  /** unitsSold / sessions -- null if sessions is null or 0. */
  cvr: number | null;
  /** Site-wide sessions (all pages, not just /products/) whose utm_source
   * classifies as Google -- see classifyUtmSource in the Shopify connector.
   * Null if the ShopifyQL call failed. */
  googleSessions: number | null;
  /** Same, classified as Meta. */
  metaSessions: number | null;
}

export interface ShopifySummaryResponse {
  from: string;
  to: string;
  summary: ShopifyOrderSummary;
}

export interface ShopifyProductRow {
  productId: string;
  productHandle: string | null;
  sku: string | null;
  title: string | null;
  productType: string | null;
  vendor: string | null;
  unitsSold: number;
  revenue: number;
  orders: number; // distinct orders containing this product
  /** Landing-page sessions for this product's URL (Shopify Analytics, live).
   * Null if productHandle is null (pre-migration row, not yet re-synced) or
   * the product had zero attributed sessions. */
  sessions: number | null;
  /** unitsSold / sessions -- null if sessions is null or 0. */
  cvr: number | null;
  /** This product's landing-page sessions whose utm_source classifies as
   * Google (see classifyUtmSource in the Shopify connector). Null if
   * productHandle is null or the ShopifyQL call failed. Directional, not
   * exact -- utm_source is self-reported by the traffic source, not a
   * platform-verified attribution. */
  googleSessions: number | null;
  /** Same, classified as Meta. */
  metaSessions: number | null;
  /** Meta spend from ads whose NAME carries this product's SKU as a "FIG-..."
   * tag (see metaSkuAttribution.ts's extractSkuToken) -- summed across every
   * matching ad, regardless of campaign/ad set. 0 (not null) when no ad
   * tagged this product this period. */
  skuAttributedSpend: number;
  /** Meta spend matched via the product CATALOG instead -- product_item_id
   * decoded the same way as Products' Website ROAS (see metrics.ts's
   * META_PRODUCT_ITEM_PATTERN), matched by product handle. A different
   * Meta ad mechanism than the name-tag above (catalog/dynamic ads are
   * auto-generated, not manually named), so the two are additive, not
   * overlapping double-counts of the same spend. 0 (not null) if unmatched. */
  metaCatalogSpend: number;
  /** skuAttributedSpend + metaCatalogSpend -- this product's total known
   * Meta ad spend across both matching mechanisms. */
  adSpend: number;
  /** revenue / adSpend -- null if adSpend is 0. */
  roas: number | null;
  /** Profit on Ad Spend = Gross Profit / adSpend, Gross Profit = revenue *
   * 65% (COGS modeled at a flat 35% of selling price, same assumption as
   * Product Quadrants -- no real per-product cost data exists). Null if
   * adSpend is 0. */
  poas: number | null;
  /** Shopify Analytics "sessions_with_cart_additions" for this product's
   * landing page (live, via ShopifyQL) -- sessions that added it to cart,
   * not a raw add-to-cart event count. Null if productHandle is null or
   * the ShopifyQL call failed. */
  atc: number | null;
  /** Shopify Analytics bounce_rate for this product's landing page (live,
   * via ShopifyQL, already session-weighted server-side by Shopify -- not
   * re-derived here). Null if productHandle is null or the call failed. */
  bounceRate: number | null;
}

export interface ShopifyProductsResponse {
  from: string;
  to: string;
  products: ShopifyProductRow[];
}

// --- Product Quadrants (Shopify products x combined ad spend) --------------
//
// A statistical sub-view under Shopify, parallel to Meta's SKU Attribution:
// classifies every Shopify product into one of 4 quadrants by ad spend vs.
// sales (both split at the cross-sectional MEDIAN across products with any
// activity this period -- not an arbitrary fixed threshold), and layers on
// POAS (profit-based ROAS), a cross-sectional spend/revenue regression, and
// correlation between sessions and revenue. adSpend/adImpressions combine
// Google + Meta, matched to the Shopify product the same way Products'
// Website ROAS is (see server/src/routes/shopify.ts's product-quadrants
// route for the join logic) -- deliberately summed across platforms here,
// unlike almost everywhere else in the app, because "how did all ad spend
// on this product perform" is the actual question this view answers.
export type ProductQuadrant = "Q1" | "Q2" | "Q3" | "Q4";

export interface ProductQuadrantRow {
  productId: string;
  title: string | null;
  sku: string | null;
  productType: string | null;
  vendor: string | null;
  unitsSold: number;
  revenue: number;
  /** Combined Google + Meta ad spend matched to this product. 0 (not null)
   * when the product genuinely has no matched ad spend this period. */
  adSpend: number;
  adImpressions: number;
  sessions: number | null;
  /** Google + Meta sessions combined -- null only if BOTH are null (the
   * ShopifyQL call itself failed), not when one platform had zero. */
  marketingSessions: number | null;
  cvr: number | null;
  /** Cost of goods sold -- revenue * cogsRate (see the response-level rate). */
  cogs: number;
  /** revenue - cogs, i.e. contribution margin. */
  grossProfit: number;
  /** grossProfit / adSpend -- "profit on ad spend", the ROAS a margin-aware
   * budgeting decision should actually use. Null if adSpend is 0. */
  poas: number | null;
  /** revenue / adSpend -- plain ROAS, shown alongside POAS for comparison. Null if adSpend is 0. */
  roas: number | null;
  /** Null for a product excluded from classification (no revenue AND no ad
   * spend this period -- nothing to classify). */
  quadrant: ProductQuadrant | null;
}

export interface ProductQuadrantCorrelation {
  r: number;
  n: number;
  strength: "weak" | "moderate" | "strong";
}

/** Cross-sectional OLS across products (not a time series): revenue ~
 * adSpend, product-by-product. beta1 is the portfolio's marginal-revenue-
 * per-rupee-of-spend estimate -- a coarse but statistically real "if you
 * spent ₹X more on an under-spent product, expect ~₹(X × beta1) more
 * revenue" projection, r2 exposed so its reliability is never hidden. */
export interface ProductSpendRegression {
  beta0: number;
  beta1: number;
  r2: number;
  n: number;
}

export interface ProductQuadrantsResponse {
  from: string;
  to: string;
  cogsRate: number;
  spendMedian: number;
  revenueMedian: number;
  products: ProductQuadrantRow[];
  /** How many products had neither revenue nor ad spend this period --
   * excluded from quadrant/products above, surfaced as a count so "88
   * products" never silently becomes "62 products" with no explanation. */
  excludedInactiveCount: number;
  sessionsVsRevenue: ProductQuadrantCorrelation | null;
  marketingSessionsVsRevenue: ProductQuadrantCorrelation | null;
  spendRevenueRegression: ProductSpendRegression | null;
}

export interface ShopifyStatus {
  connected: boolean;
  lastSync: SyncLogEntry | null;
}

// --- Meta SKU attribution (Ads ROAS vs Website ROAS) ------------------------
//
// Meta-only, per user request: a Campaign > Ad Set > Ad drill-down where
// each ad's own spend is cross-referenced against Shopify's ground-truth
// per-SKU revenue -- "sku" is a token matched out of the ad's *name*
// (starting "FIG-..."), not a real ad-platform field. Most ads don't follow
// this naming convention yet (rollout in progress on the user's end); those
// show sku: null and websiteRevenue/websiteRoas: null rather than 0, so an
// unmatched ad reads as "not measured" and never as "measured zero."
//
// adsRoas is Meta's own self-reported attributed revenue / spend (same
// number the Ads section already shows); websiteRoas is Shopify's actual
// order revenue for the matched SKU(s) / the SAME spend -- two different
// ROAS answers to the same question, deliberately shown side by side, never
// summed or blended into one number.

/** The "primary parameters" every level (ad/ad-set/campaign) carries,
 * alongside the SKU/website comparison fields below -- rolled up
 * weighted (sum/sum), never averaged. */
interface MetaSkuPerformance {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cvr: number | null;
  cpc: number | null;
  cpa: number | null;
  adsRevenue: number;
  adsRoas: number | null;
  /** Sum of Shopify line-item revenue for SKUs starting with `sku` (ad
   * level) or the weighted rollup of only the matched children (ad-set/
   * campaign level), over the same date range. Null (not 0) when nothing
   * matched -- distinct from a real, measured ₹0. */
  websiteRevenue: number | null;
  websiteRoas: number | null;
}

export interface MetaSkuAdRow extends MetaSkuPerformance {
  adId: string;
  adName: string | null;
  adType: string | null;
  adStatus: string | null;
  /** Token extracted from adName (e.g. "FIG-05-007-RD"), or null if the ad
   * name doesn't contain one yet. Matched against Shopify SKUs as a PREFIX
   * (a shorter token like "FIG-01-029" can match several color/size variant
   * SKUs at once -- see extractSkuToken's comment in
   * server/src/routes/metaSkuAttribution.ts), so this is the token as
   * extracted, not necessarily a single exact Shopify SKU. */
  sku: string | null;
}

export interface MetaSkuAdSetGroup extends MetaSkuPerformance {
  adSetId: string;
  adSetName: string | null;
  ads: MetaSkuAdRow[];
}

export interface MetaSkuCampaignGroup extends MetaSkuPerformance {
  campaignId: string;
  campaignName: string | null;
  adSets: MetaSkuAdSetGroup[];
}

/** One row per distinct SKU tag, combining EVERY ad that carries it
 * regardless of campaign/ad set -- the fix for the per-ad/per-campaign
 * views' distortion (N ads sharing one SKU each showing that SKU's full
 * revenue against only their own spend). Here, spend is the SKU's TRUE
 * combined spend across every tagged ad, so websiteRoas is the one
 * honest "true" website ROAS for that product, not repeated N times at
 * N different (wrong) values. */
export interface MetaSkuGroupRow extends MetaSkuPerformance {
  sku: string;
  /** The SKU tag can prefix-match several distinct Shopify SKU variants
   * (see server/src/routes/metaSkuAttribution.ts's extractSkuToken
   * comment) -- this is the highest-revenue matching variant's product
   * title, i.e. the one actually driving websiteRevenue, not necessarily
   * the only product folded into this row. Null if no Shopify SKU matched
   * (websiteRevenue is null in that case too). */
  productTitle: string | null;
  /** How many distinct product titles matched this SKU tag -- 1 means
   * productTitle is the whole story; >1 means it's the dominant one among
   * several (the UI shows "+N more"). */
  variantCount: number;
  adCount: number;
  campaignCount: number;
}

export interface MetaSkuAttributionResponse {
  from: string;
  to: string;
  campaigns: MetaSkuCampaignGroup[];
  /** Sorted by spend desc -- one row per distinct SKU tag, see MetaSkuGroupRow. */
  skuGroups: MetaSkuGroupRow[];
  matchedAds: number;
  totalAds: number;
}

// --- Meta Creative Performance (per-creative naming-convention breakdown) --
//
// Meta-only, a second lens on the same ad-name-tagging idea as SKU
// Attribution above, but for the CREATIVE itself rather than just the SKU:
// the ad's name carries a full structured tag wrapped in "$...$" --
// $[SKU]_[IMG/VID/CRSL/GIF/UGC]_[Aesth/Price/Gift/Occ/Qlty/Featr/Lif/Exp]_
//  [POV/Demo/BeforeAfter/Testi/Unbox]_[M/F/NA]_v(n)_n(n)$
// -- parsed server-side (server/src/util/creativeTag.ts) into format/angle/
// style/gender/version/variant, on top of the same SKU token this shares
// with SKU Attribution. Every field but SKU+format is optional in practice
// (real tagging is inconsistent about which ones get filled in -- same
// rollout-in-progress reality as the SKU tags), so all of them are nullable
// here; a null field reads as "not tagged", never a guessed default.
export type CreativeFormat = "IMG" | "VID" | "CRSL" | "GIF" | "UGC";
export type CreativeAngle = "Aesth" | "Price" | "Gift" | "Occ" | "Qlty" | "Featr" | "Lif" | "Exp";
export type CreativeStyle = "POV" | "Demo" | "BeforeAfter" | "Testi" | "Unbox";
export type CreativeGender = "M" | "F" | "NA";

/** Same shape/semantics as MetaSkuPerformance -- weighted rollup (sum/sum,
 * never averaged), websiteRevenue/websiteRoas null (not 0) when nothing
 * in the group matched a SKU. */
interface MetaCreativePerformance {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cvr: number | null;
  cpc: number | null;
  cpa: number | null;
  adsRevenue: number;
  adsRoas: number | null;
  websiteRevenue: number | null;
  websiteRoas: number | null;
}

export interface MetaCreativeAdRow extends MetaCreativePerformance {
  adId: string;
  adName: string | null;
  adType: string | null;
  adStatus: string | null;
  sku: string | null;
  format: CreativeFormat | null;
  angle: CreativeAngle | null;
  style: CreativeStyle | null;
  gender: CreativeGender | null;
  version: number | null;
  variant: number | null;
  /** True once the SKU inside "$...$" parsed -- see isTaggedCreative in
   * server/src/util/creativeTag.ts. format/angle/style/gender/version/
   * variant are all optional and commonly null even on a "tagged" row --
   * the real rollout ships a bare "$SKU$" with none of them (confirmed
   * live 2026-08-19). */
  tagged: boolean;
}

export interface MetaCreativeAdSetGroup extends MetaCreativePerformance {
  adSetId: string;
  adSetName: string | null;
  ads: MetaCreativeAdRow[];
}

export interface MetaCreativeCampaignGroup extends MetaCreativePerformance {
  campaignId: string;
  campaignName: string | null;
  adSets: MetaCreativeAdSetGroup[];
}

/** One row per distinct SKU (product), combining every tagged creative for
 * it regardless of campaign/ad set -- the "true" website ROAS for that
 * product, same fix as MetaSkuGroupRow. `creatives` is the full per-ad
 * breakdown for that product (format/angle/style/gender/version, spend,
 * status, ...) -- this is what answers "this product has N creatives, here's
 * how each is performing and its status", sorted by spend desc. */
export interface MetaCreativeProductGroup extends MetaCreativePerformance {
  sku: string;
  productTitle: string | null;
  variantCount: number;
  creativeCount: number;
  campaignCount: number;
  creatives: MetaCreativeAdRow[];
}

export interface MetaCreativePerformanceResponse {
  from: string;
  to: string;
  campaigns: MetaCreativeCampaignGroup[];
  /** Sorted by spend desc -- one row per distinct SKU, see MetaCreativeProductGroup. */
  products: MetaCreativeProductGroup[];
  /** Ads with a SKU parsed out of a "$...$" tag (may still be missing format/etc). */
  matchedAds: number;
  /** Ads with a full enough tag to count as a real creative (sku + format -- see isTaggedCreative). */
  taggedAds: number;
  totalAds: number;
}

// --- statistics layer: route response shapes (spec §3b/§2/§4/§6) -----------

export interface CompareCampaignsResponse {
  campaignA: { campaignId: string; campaignName: string | null; conversions: number; clicks: number; cvr: number };
  campaignB: { campaignId: string; campaignName: string | null; conversions: number; clicks: number; cvr: number };
  z: number;
  significant: boolean;
  verdict: string;
  confidence: "sufficient" | "insufficient";
}

export interface AnomalyPoint {
  date: string;
  value: number;
  direction: "high" | "low";
  fenceDistance: number;
}

export interface AnomaliesResponse {
  campaignId: string;
  n: number;
  spend: AnomalyPoint[];
  cpa: AnomalyPoint[];
  /** True once n>=8 (spec §2 IQR gate); when false, absence of flags means "not enough data," not "nothing unusual." */
  metGate: boolean;
}

export interface CorrelationSummary {
  r: number;
  n: number;
  strength: "weak" | "moderate" | "strong";
  label: "association, not causation";
}

export interface DiminishingReturnsSummary {
  n: number;
  beta1: number;
  r2: number;
  reliable: boolean;
  budgetCeiling: number | null;
}

export interface DiagnosticsResponse {
  campaignId: string;
  spendVsRoas: CorrelationSummary | null; // null if n<10 -- insufficient
  ctrVsCvr: CorrelationSummary | null;
  diminishingReturns: DiminishingReturnsSummary | null; // null if n<14
}

export interface ParetoPointDTO {
  campaignId: string;
  campaignName: string | null;
  revenue: number;
  spend: number;
  cumulativePct: number;
}

export interface ContributionRowDTO {
  campaignId: string;
  campaignName: string | null;
  contribution: number;
  pctOfTotal: number | null;
}

export interface PortfolioResponse {
  from: string;
  to: string;
  platform: Platform;
  campaignsToEightyPercent: number;
  totalCampaigns: number;
  pareto: ParetoPointDTO[];
  contribution: ContributionRowDTO[];
}

// --- Google Ads: product-level (Shopping/PMax) and ad-level grain ----------
//
// Two different breakdowns of the SAME campaign spend -- never summed with
// each other or with fact_ad_performance (campaign grain). Each reconciles
// independently back to campaign totals; see ReconciliationInfo. Build spec:
// "FIG Living — Google Ads: Product-Level & Ad-Level Spend."

/** How closely a grain's summed spend matches the campaign total it's a
 * breakdown of. `deviationPct` is null (never 0/NaN) when campaignSpend is
 * 0 -- nothing to reconcile against. */
export interface ReconciliationInfo {
  grainSpend: number;
  campaignSpend: number;
  deviationPct: number | null;
  withinTolerance: boolean;
  tolerancePct: number;
}

/** Only Google and Meta have a connector for either grain (Amazon on hold,
 * Myntra CSV-only, no ad/product-level breakdown at all). */
export type GrainPlatform = "google" | "meta";

export type ProductGroupBy = "sku" | "type_l1" | "type_l2";

export interface ProductPerformanceRow extends DerivedMetrics {
  /** Group key -- product_item_id for "sku", product_type_l1 (or "—") for
   * "type_l1", "type_l1|type_l2" for "type_l2". */
  key: string;
  productItemId: string | null; // present only at groupBy="sku"
  productTitle: string | null; // present only at groupBy="sku"
  productTypeL1: string | null;
  productTypeL2: string | null;
  /** Distinct SKUs folded into this row -- 1 at groupBy="sku", >1 at a roll-up level. */
  skuCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /** Ad-platform-attributed revenue (Google Shopping / Meta catalog match) --
   * directional per the section's caveat banner, not ground truth. */
  revenue: number;
  /** Shopify's actual order revenue for this exact catalog item (matched via
   * product handle on Meta, product+variant id on Google -- see
   * server/src/routes/metrics.ts's websiteRevenueForProductItem). Only
   * populated at groupBy="sku" (a category roll-up mixes join keys); null
   * when nothing matched, not 0. This is the ground truth `revenue` above
   * is only a platform's claim about. */
  websiteRevenue: number | null;
  /** websiteRevenue ÷ spend -- the "true ROAS" (TROAS), as opposed to
   * `roas` (in DerivedMetrics), which uses the platform-attributed `revenue`. */
  websiteRoas: number | null;
}

export interface MetricsProductsResponse {
  from: string;
  to: string;
  platform: GrainPlatform;
  groupBy: ProductGroupBy;
  campaignId: string | null; // null = all campaigns
  products: ProductPerformanceRow[];
  reconciliation: ReconciliationInfo;
}

export interface ProductParetoPointDTO {
  productItemId: string;
  productTitle: string | null;
  revenue: number;
  cumulativePct: number;
}

/** Spend with zero orders over the range -- a feed/targeting leak candidate. */
export interface TailLeakRow {
  productItemId: string;
  productTitle: string | null;
  spend: number;
}

export interface MetricsProductsParetoResponse {
  from: string;
  to: string;
  skusToEightyPercent: number;
  totalSkus: number;
  pareto: ProductParetoPointDTO[];
  tailLeaks: TailLeakRow[];
}

export interface AdRow extends DerivedMetrics {
  adId: string;
  adName: string | null;
  adType: string | null;
  adStatus: string | null;
  adGroupId: string;
  adGroupName: string | null;
  campaignId: string;
  campaignName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export interface MetricsAdsResponse {
  from: string;
  to: string;
  platform: GrainPlatform;
  campaignId: string | null;
  adGroupId: string | null;
  ads: AdRow[];
  reconciliation: ReconciliationInfo;
}

// --- Settings (API integrations + editable COGS/EBITDA cost inputs) --------
//
// App-wide, not per-user (this tool has no accounts) -- one shared singleton
// row in Postgres (db/migrations/0008_app_settings.sql). Integration status
// is deliberately connected/not-connected ONLY, never the actual key/token
// values -- this page is reachable by everyone the site password is shared
// with, so real credentials never cross the wire here.

export type AdditionalCostType = "percent_of_revenue" | "flat_per_order" | "flat_total";

export interface AdditionalCost {
  id: string;
  name: string;
  type: AdditionalCostType;
  /** percent_of_revenue: a fraction (0.02 = 2%). flat_per_order: currency
   * per order. flat_total: a flat currency amount for the selected range,
   * regardless of its length -- a modeling simplification the UI calls out. */
  value: number;
}

export interface AppSettings {
  /** Cost of goods sold as a fraction of selling price (0.35 = 35%). */
  cogsRate: number;
  additionalCosts: AdditionalCost[];
  updatedAt: string;
}

export interface IntegrationStatus {
  id: string;
  label: string;
  connected: boolean;
  /** Env var name(s) this integration reads -- shown so an admin knows what
   * to set, never the values themselves. */
  envVars: string[];
}

export interface SettingsResponse {
  settings: AppSettings;
  integrations: IntegrationStatus[];
}

// --- Projection Sheet (Shopify -> ↳ Projection Sheet) -----------------------
//
// Monthly planning tool: set a Unit Target + Price per product, see the
// traffic/spend that target implies, and track pace against it this month.
// Always "this month" (server's current IST date) -- no month picker yet,
// though the DB schema (db/migrations/0009_product_targets.sql) is already
// keyed by month for when one gets added. Every field below except
// unitTarget/price is computed live on every request, never stored.

export type ProjectionInsightVerdict = "on_track" | "increase_sessions" | "review_ads" | "behind_and_low_traffic" | "no_target";

export interface ProjectionInsight {
  verdict: ProjectionInsightVerdict;
  message: string;
}

export interface ProjectionRow {
  productId: string;
  productHandle: string | null;
  title: string;
  /** User-entered, from product_targets -- null until set. */
  unitTarget: number | null;
  /** User-entered, from product_targets -- null until set. */
  price: number | null;
  /** Units actually sold last calendar month -- offered as a one-click fill
   * for Unit Target ("plan to match last month"), not a suggestion the
   * server picks for you. */
  previousMonthUnitsSold: number;
  /** Live Shopify selling price (min-variant), fetched from the catalog --
   * offered as a one-click fill for Price. Null if the catalog fetch failed
   * or the product has no priced variant. */
  shopifyPrice: number | null;
  /** unitTarget * price -- null if either input is unset. */
  targetRevenue: number | null;
  /** unitTarget / previousMonthCvr -- null if unitTarget or CVR is unset/null. */
  requiredTraffic: number | null;
  /** Meta catalog CPM (spend / impressions * 1000) for this product, previous month. Null if unmatched/no impressions. */
  cpm: number | null;
  /** (1000 / cpm) * requiredTraffic * 0.8 -- null if cpm or requiredTraffic is null. */
  minAdSpendRequired: number | null;
  /** unitTarget / days in the current month. */
  plannedDrr: number | null;
  /** mtdUnitsSold / day-of-month (today's date number, 1-indexed). */
  currentDrr: number | null;
  /** currentDrr * days in the current month -- the pace-extrapolated month-end unit count. */
  projectedUnitsMonthEnd: number | null;
  mtdUnitsSold: number;
  /** Site-wide, all sources -- same figure as mtdTotalSessions below (shown
   * once here near units, once again after the channel breakdown, matching
   * the requested column list). */
  mtdTotalSessionsEarly: number | null;
  /** previousMonthSessions / previousMonthUnitsSold -- units per session,
   * i.e. the conventional CVR (confirmed against the attached spreadsheet's
   * own numbers, which used this direction, not sessions/units as the
   * request text literally said). Null if either side is 0/null. */
  previousMonthCvr: number | null;
  currentMonthCvr: number | null;
  mtdMetaSessions: number | null;
  mtdGoogleSessions: number | null;
  /** mtdTotalSessions - meta - google -- sessions from other/unclassified sources. Null if mtdTotalSessions is null. */
  mtdRestSessions: number | null;
  mtdTotalSessions: number | null;
  /** mtdMetaSessions / mtdTotalSessions. Null if mtdTotalSessions is null/0. */
  mtdMetaSessionsSharePct: number | null;
  /** (mtdTotalSessions / day-of-month) * days in the current month -- the pace-extrapolated month-end session count. */
  projectedSessionsMonthEnd: number | null;
  insight: ProjectionInsight;
}

export interface ProjectionResponse {
  month: string; // "YYYY-MM"
  daysInMonth: number;
  dayOfMonth: number;
  rows: ProjectionRow[];
}

export interface ProjectionUpdateEntry {
  productId: string;
  unitTarget: number | null;
  price: number | null;
}

export interface ProjectionUpdateRequest {
  updates: ProjectionUpdateEntry[];
}
