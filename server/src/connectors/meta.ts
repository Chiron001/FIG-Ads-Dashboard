import type { AdsConnector, CampaignRosterEntry, CanonicalRowInput, RawRow } from "@fig/shared";
import { env } from "../config/env";
import type { ProductPerformanceInput, AdPerformanceInput } from "../etl/grainTypes";

// Marketing API Insights edge, adset-level daily rows. Field mapping per
// spec §3: spend -> spend, actions[purchase] -> conversions,
// action_values[purchase] -> revenue.
const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Explicitly requested (not left to the ad account's default setting) so
// the "meta_7d_click" attribution_window label we store is actually
// accurate, not just assumed — same principle as the Google connector not
// silently mislabeling dates when the account timezone isn't IST.
const ATTRIBUTION_WINDOW_PARAM = "7d_click";
const ATTRIBUTION_WINDOW_LABEL = "meta_7d_click";

const INSIGHTS_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "spend",
  "impressions",
  "clicks",
  "actions",
  "action_values",
  "date_start",
].join(",");

// --- ad-level grain ----------------------------------------------------------
//
// level=ad, no breakdown -- effectively every Meta campaign has ad-level
// rows (unlike Google, where Shopping/PMax has no ad_group_ad rows). Ad
// status/type aren't valid Insights fields (confirmed live: "(#100)
// effective_status is not valid for fields param") -- fetched separately
// via the /ads edge and joined in-memory by ad_id, same pattern as
// fetchCampaignRoster.
const AD_INSIGHTS_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "actions",
  "action_values",
  "date_start",
].join(",");

// --- product-level grain -----------------------------------------------------
//
// Insights breakdowns=product_id -- Meta's catalog/pixel product matching,
// not Shopping-specific despite the shared table name. Confirmed live this
// account gets real product_id rows even on non-DPA ("UGC") campaigns, via
// pixel-side product matching against the connected catalog. No category
// breakdown is exposed this way (would need a separate Product Catalog API
// call to enrich by product_id -- not built, see grainTypes.ts).
//
// Confirmed live: combining this breakdown with time_increment=1 over a
// long date range intermittently fails with a generic "Service temporarily
// unavailable" (code 2) -- short (<=7 day) chunks are reliable, longer
// single requests are not. fetchProductPerformance chunks internally.
const PRODUCT_INSIGHTS_FIELDS = ["campaign_id", "campaign_name", "ad_id", "ad_name", "spend", "impressions", "clicks", "actions", "action_values"].join(
  ","
);
const PRODUCT_BREAKDOWN_CHUNK_DAYS = 7;

interface MetaActionValue {
  action_type: string;
  value: string;
  // When action_attribution_windows is passed, Meta adds a same-named key
  // per requested window (e.g. "7d_click") alongside the generic "value".
  // "value" is NOT guaranteed to equal that window's number for every
  // account/action combination -- read the named key explicitly so the
  // meta_7d_click label we store is actually accurate, not assumed.
  [attributionWindowKey: string]: string | undefined;
}

interface MetaInsightRow {
  campaign_id: string;
  campaign_name?: string;
  adset_id: string;
  adset_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaActionValue[];
  action_values?: MetaActionValue[];
  date_start: string;
}

interface MetaCampaignRosterRow {
  id: string;
  name?: string;
  // effective_status is more informative than the basic `status` field --
  // it reflects things like budget exhaustion / ad-set-level pauses, not
  // just whether the campaign object itself is toggled on.
  effective_status?: string;
}

interface MetaAdInsightRow {
  campaign_id: string;
  campaign_name?: string;
  adset_id: string;
  adset_name?: string;
  ad_id: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaActionValue[];
  action_values?: MetaActionValue[];
  date_start: string;
}

interface MetaAdRosterRow {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: { object_type?: string };
}

interface MetaProductInsightRow {
  campaign_id: string;
  campaign_name?: string;
  ad_id: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaActionValue[];
  action_values?: MetaActionValue[];
  date_start: string;
  // Meta returns this breakdown dimension as "<catalog_product_id>, <title>"
  // in one string -- confirmed live, no separate title field.
  product_id?: string;
}

interface MetaApiResponse<T> {
  data: T[];
  paging?: { next?: string };
  error?: { message: string; type: string; code: number; error_subcode?: number; fbtrace_id?: string };
}

const RATE_LIMIT_ERROR_CODES = new Set([17, 613]); // spec §4b: back off on these specifically
// Generic "Service temporarily unavailable" -- confirmed live on the
// product_id breakdown query (Meta's own docs: transient, retry). Distinct
// from RATE_LIMIT_ERROR_CODES (spec §4b names those specifically), but
// retried the same way.
const TRANSIENT_ERROR_CODES = new Set([2]);
const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Splits [from, to] into <=chunkDays-day inclusive windows -- see
 * PRODUCT_BREAKDOWN_CHUNK_DAYS's comment for why fetchProductPerformance
 * needs this and fetchAdPerformance/fetchRaw don't. */
function chunkDateRange(from: string, to: string, chunkDays: number): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  let cursor = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + (chunkDays - 1) * 86400000, end.getTime()));
    chunks.push({ from: cursor.toISOString().slice(0, 10), to: chunkEnd.toISOString().slice(0, 10) });
    cursor = new Date(chunkEnd.getTime() + 86400000);
  }
  return chunks;
}

/** Meta's product_id breakdown value is "<id>, <title>" in one string
 * (confirmed live) -- split on the first comma; title may itself contain
 * commas, so this can't just split(",") and take [0]/[1]. */
function parseProductIdField(raw: string | undefined): { id: string; title: string | null } {
  if (!raw) return { id: "unknown", title: null };
  const commaIdx = raw.indexOf(",");
  if (commaIdx === -1) return { id: raw.trim(), title: null };
  return { id: raw.slice(0, commaIdx).trim(), title: raw.slice(commaIdx + 1).trim() || null };
}

async function metaGet<T>(url: string): Promise<MetaApiResponse<T>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      // Network-level failure (ECONNRESET etc, confirmed live on a
      // product-breakdown chunk request) -- fetch() throws before there's
      // any response to inspect, so this can't be caught by the
      // body.error/429 branch below. Retry it the same way as a rate
      // limit: transient, not a real API error.
      if (attempt < MAX_RETRIES) {
        const backoffMs = 2 ** attempt * 1000;
        console.warn(
          `[meta connector] network error (${(err as Error).message}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }
    const body = (await res.json()) as MetaApiResponse<T>;

    if (body.error) {
      const isRetryable = RATE_LIMIT_ERROR_CODES.has(body.error.code) || TRANSIENT_ERROR_CODES.has(body.error.code) || res.status === 429;
      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffMs = 2 ** attempt * 1000;
        console.warn(
          `[meta connector] retryable error (code ${body.error.code}: ${body.error.message}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(backoffMs);
        continue;
      }
      throw new Error(`Meta API error ${body.error.code}: ${body.error.message}`);
    }

    return body;
  }
  throw new Error("Meta API: exhausted retries without a non-rate-limited response.");
}

/** Finds the purchase entry in a Meta actions/action_values array. Meta uses
 * "purchase" for standard pixel/CAPI events, but falls back to
 * "omni_purchase" (Meta's cross-channel-deduped aggregate) when "purchase"
 * isn't present — some accounts only populate the omni variant. */
function findPurchaseValue(entries: MetaActionValue[] | undefined): number {
  if (!entries) return 0;
  const purchase = entries.find((e) => e.action_type === "purchase") ?? entries.find((e) => e.action_type === "omni_purchase");
  if (!purchase) return 0;
  // Prefer the explicitly-windowed key (matches ATTRIBUTION_WINDOW_PARAM,
  // e.g. "7d_click") over the generic "value", which isn't guaranteed to
  // equal that window's number.
  const windowed = purchase[ATTRIBUTION_WINDOW_PARAM];
  return Number(windowed ?? purchase.value);
}

export class MetaAdsConnector implements AdsConnector {
  platform = "meta" as const;

  private accessToken: string | null = null;
  private adAccountId: string | null = null;

  async authenticate(): Promise<void> {
    const { accessToken, adAccountId } = env.meta;
    const missing = Object.entries({ accessToken, adAccountId })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`Meta Ads connector: missing env var(s): ${missing.join(", ")}. See .env.example.`);
    }

    this.accessToken = accessToken!;
    this.adAccountId = adAccountId!;

    // Real connectivity + permission check, same pattern as the Google
    // connector's customer.time_zone probe: fails loudly here with a clear
    // reason rather than deep inside fetchRaw().
    const url = `${GRAPH_BASE}/${this.adAccountId}?fields=name,currency,timezone_name&access_token=${this.accessToken}`;
    const info = await metaGet<never>(url);
    const account = info as unknown as { name: string; currency: string; timezone_name: string };

    if (account.currency !== "INR") {
      console.warn(
        `[meta connector] Ad account currency is "${account.currency}", not INR. This project has no FX layer — spend/revenue will be stored as-is, mislabeled as INR unless the normalization layer is updated.`
      );
    }
    if (account.timezone_name !== "Asia/Kolkata") {
      console.warn(
        `[meta connector] Ad account timezone is "${account.timezone_name}", not Asia/Kolkata. Daily buckets from Meta won't line up exactly with IST calendar days.`
      );
    }
  }

  async fetchRaw(from: string, to: string): Promise<RawRow[]> {
    if (!this.accessToken || !this.adAccountId) {
      throw new Error("Meta Ads connector: call authenticate() before fetchRaw().");
    }

    const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }));
    let url =
      `${GRAPH_BASE}/${this.adAccountId}/insights` +
      `?level=adset` +
      `&fields=${INSIGHTS_FIELDS}` +
      `&time_increment=1` +
      `&time_range=${timeRange}` +
      `&action_attribution_windows=${ATTRIBUTION_WINDOW_PARAM}` +
      `&limit=200` +
      `&access_token=${this.accessToken}`;

    const rows: MetaInsightRow[] = [];
    while (url) {
      const page = await metaGet<MetaInsightRow>(url);
      rows.push(...page.data);
      url = page.paging?.next ?? "";
    }

    return rows as unknown as RawRow[];
  }

  async fetchCampaignRoster(): Promise<CampaignRosterEntry[]> {
    if (!this.accessToken || !this.adAccountId) {
      throw new Error("Meta Ads connector: call authenticate() before fetchCampaignRoster().");
    }

    // Independent of any date range -- the Insights edge (fetchRaw) only
    // ever returns adsets with actual activity in the window, so a paused
    // or quiet-this-week campaign is invisible to it entirely. This reads
    // straight from the campaigns edge instead.
    let url =
      `${GRAPH_BASE}/${this.adAccountId}/campaigns` + `?fields=id,name,effective_status` + `&limit=200` + `&access_token=${this.accessToken}`;

    const rows: MetaCampaignRosterRow[] = [];
    while (url) {
      const page = await metaGet<MetaCampaignRosterRow>(url);
      rows.push(...page.data);
      url = page.paging?.next ?? "";
    }

    return rows
      .filter((r) => r.effective_status !== "DELETED")
      .map((r) => ({
        campaignId: r.id,
        campaignName: r.name ?? null,
        status: r.effective_status ?? null,
      }));
  }

  normalize(rows: RawRow[]): CanonicalRowInput[] {
    return (rows as unknown as MetaInsightRow[]).map((row) => ({
      platform: "meta",
      campaignId: row.campaign_id,
      campaignName: row.campaign_name ?? null,
      adGroupId: row.adset_id,
      adGroupName: row.adset_name ?? null,
      date: row.date_start,
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      conversions: findPurchaseValue(row.actions),
      revenue: findPurchaseValue(row.action_values),
      attributionWindow: ATTRIBUTION_WINDOW_LABEL,
      searchImpressionShare: null, // Google Search-only concept, not applicable to Meta
      searchBudgetLostImpressionShare: null,
      raw: row as unknown as Record<string, unknown>,
    }));
  }

  // --- ad-level grain --------------------------------------------------------

  private async fetchAdRoster(): Promise<Map<string, MetaAdRosterRow>> {
    let url =
      `${GRAPH_BASE}/${this.adAccountId}/ads` +
      `?fields=id,name,effective_status,creative{object_type}` +
      `&limit=200` +
      `&access_token=${this.accessToken}`;

    const byId = new Map<string, MetaAdRosterRow>();
    while (url) {
      const page = await metaGet<MetaAdRosterRow>(url);
      for (const r of page.data) byId.set(r.id, r);
      url = page.paging?.next ?? "";
    }
    return byId;
  }

  async fetchAdPerformance(from: string, to: string): Promise<RawRow[]> {
    if (!this.accessToken || !this.adAccountId) {
      throw new Error("Meta Ads connector: call authenticate() before fetchAdPerformance().");
    }

    const roster = await this.fetchAdRoster();
    const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }));
    let url =
      `${GRAPH_BASE}/${this.adAccountId}/insights` +
      `?level=ad` +
      `&fields=${AD_INSIGHTS_FIELDS}` +
      `&time_increment=1` +
      `&time_range=${timeRange}` +
      `&action_attribution_windows=${ATTRIBUTION_WINDOW_PARAM}` +
      `&limit=200` +
      `&access_token=${this.accessToken}`;

    const rows: (MetaAdInsightRow & { _status?: string; _type?: string })[] = [];
    while (url) {
      const page = await metaGet<MetaAdInsightRow>(url);
      for (const r of page.data) {
        const rosterEntry = roster.get(r.ad_id);
        rows.push({ ...r, _status: rosterEntry?.effective_status, _type: rosterEntry?.creative?.object_type });
      }
      url = page.paging?.next ?? "";
    }

    return rows as unknown as RawRow[];
  }

  normalizeAdPerformance(rows: RawRow[]): AdPerformanceInput[] {
    return (rows as unknown as (MetaAdInsightRow & { _status?: string; _type?: string })[]).map((row) => ({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name ?? null,
      adGroupId: row.adset_id,
      adGroupName: row.adset_name ?? null,
      adId: row.ad_id,
      adName: row.ad_name ?? null,
      adType: row._type ?? null,
      // effective_status is Meta's own vocabulary (ACTIVE/PAUSED/ARCHIVED/
      // DELETED/...) -- same normalizeStatus() the UI already uses for
      // campaign status handles this, no extra mapping needed.
      adStatus: row._status ?? null,
      date: row.date_start,
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      conversions: findPurchaseValue(row.actions),
      revenue: findPurchaseValue(row.action_values),
      raw: row as unknown as Record<string, unknown>,
    }));
  }

  // --- product-level grain -----------------------------------------------------

  async fetchProductPerformance(from: string, to: string): Promise<RawRow[]> {
    if (!this.accessToken || !this.adAccountId) {
      throw new Error("Meta Ads connector: call authenticate() before fetchProductPerformance().");
    }

    const rows: MetaProductInsightRow[] = [];
    // Chunked, not one request for the whole range -- see
    // PRODUCT_BREAKDOWN_CHUNK_DAYS's comment.
    for (const chunk of chunkDateRange(from, to, PRODUCT_BREAKDOWN_CHUNK_DAYS)) {
      const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.from, until: chunk.to }));
      let url =
        `${GRAPH_BASE}/${this.adAccountId}/insights` +
        `?level=ad` +
        `&fields=${PRODUCT_INSIGHTS_FIELDS}` +
        `&breakdowns=product_id` +
        `&time_increment=1` +
        `&time_range=${timeRange}` +
        `&action_attribution_windows=${ATTRIBUTION_WINDOW_PARAM}` +
        `&limit=200` +
        `&access_token=${this.accessToken}`;

      while (url) {
        const page = await metaGet<MetaProductInsightRow>(url);
        rows.push(...page.data);
        url = page.paging?.next ?? "";
      }
    }

    return rows as unknown as RawRow[];
  }

  normalizeProductPerformance(rows: RawRow[]): ProductPerformanceInput[] {
    return (rows as unknown as MetaProductInsightRow[]).map((row) => {
      const { id, title } = parseProductIdField(row.product_id);
      return {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name ?? null,
        productItemId: id,
        productTitle: title,
        productBrand: null, // not exposed via this breakdown
        productTypeL1: null, // Meta's product_id breakdown has no category dimension -- see grainTypes.ts
        productTypeL2: null,
        productTypeL3: null,
        productChannel: null,
        date: row.date_start,
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: findPurchaseValue(row.actions),
        revenue: findPurchaseValue(row.action_values),
        raw: row as unknown as Record<string, unknown>,
      };
    });
  }
}
