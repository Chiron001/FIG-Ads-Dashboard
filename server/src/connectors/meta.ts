import type { AdsConnector, CampaignRosterEntry, CanonicalRowInput, RawRow } from "@fig/shared";
import { env } from "../config/env";

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

interface MetaApiResponse<T> {
  data: T[];
  paging?: { next?: string };
  error?: { message: string; type: string; code: number; error_subcode?: number; fbtrace_id?: string };
}

const RATE_LIMIT_ERROR_CODES = new Set([17, 613]); // spec §4b: back off on these specifically
const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function metaGet<T>(url: string): Promise<MetaApiResponse<T>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    const body = (await res.json()) as MetaApiResponse<T>;

    if (body.error) {
      const isRateLimit = RATE_LIMIT_ERROR_CODES.has(body.error.code) || res.status === 429;
      if (isRateLimit && attempt < MAX_RETRIES) {
        const backoffMs = 2 ** attempt * 1000;
        console.warn(
          `[meta connector] rate limited (code ${body.error.code}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
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
      raw: row as unknown as Record<string, unknown>,
    }));
  }
}
