import type { AdsConnector, CampaignRosterEntry, CanonicalRowInput, RawRow } from "@fig/shared";
import { env } from "../config/env";

// Amazon Ads API v3 Reporting -- Sponsored Products only for now (the
// large majority of typical seller ad spend). Sponsored Brands/Display use
// their own report schemas and could be added later as additional grain
// syncs, same pattern as Google/Meta's optional product/ad grain methods.
//
// NOT YET VERIFIED LIVE. Built against Amazon's public v3 Reporting API
// docs before this account had real credentials to test against (Amazon
// Ads API access requires a separate approval Amazon grants per Client ID
// -- see README/.env.example). Column names, report-type id, and the
// campaign-list endpoint's exact response shape should all be spot-checked
// on the first real sync and adjusted if Amazon's actual response differs
// -- flagged here rather than claimed "confirmed live" the way this
// project's other connectors document their own live checks, since this
// one hasn't had that chance yet.

const REGION_ENDPOINTS: Record<string, string> = {
  na: "https://advertising-api.amazon.com",
  eu: "https://advertising-api-eu.amazon.com",
  fe: "https://advertising-api-fe.amazon.com",
};

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
// Amazon's own Sponsored Products default attribution window for the
// purchases14d/sales14d columns below -- a 14-day click window, distinct
// from (and not comparable to) Meta's 7d_click or Google's data-driven
// attribution. Label follows this project's existing "platform_window"
// convention (meta_7d_click, google_dda, ...).
const ATTRIBUTION_WINDOW_LABEL = "amazon_14d_click";

const REPORT_COLUMNS = [
  "date",
  "campaignId",
  "campaignName",
  "adGroupId",
  "adGroupName",
  "impressions",
  "clicks",
  "cost",
  "purchases14d",
  "sales14d",
] as const;

interface AmazonReportRow {
  date: string;
  campaignId: number | string;
  campaignName?: string;
  adGroupId?: number | string;
  adGroupName?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  purchases14d?: number;
  sales14d?: number;
}

interface AmazonCreateReportResponse {
  reportId: string;
}

interface AmazonReportStatusResponse {
  status: string; // PENDING | PROCESSING | COMPLETED | FAILED
  url?: string;
}

interface AmazonCampaignListRow {
  campaignId: number | string;
  name?: string;
  state?: string; // enabled | paused | archived
}

interface AmazonCampaignListResponse {
  campaigns?: AmazonCampaignListRow[];
}

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AmazonAdsConnector implements AdsConnector {
  platform = "amazon" as const;

  private accessToken: string | null = null;
  private baseUrl: string | null = null;

  async authenticate(): Promise<void> {
    const { clientId, clientSecret, refreshToken, profileId, region } = env.amazon;
    const missing = Object.entries({ clientId, clientSecret, refreshToken, profileId, region })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`Amazon Ads connector: missing env var(s): ${missing.join(", ")}. See .env.example.`);
    }

    this.baseUrl = REGION_ENDPOINTS[region!.toLowerCase()];
    if (!this.baseUrl) {
      throw new Error(`Amazon Ads connector: AMAZON_REGION "${region}" must be one of na/eu/fe.`);
    }

    // Exchanges the long-lived refresh token for a short-lived access token
    // -- the same LWA token endpoint scripts/amazon-get-refresh-token.ts
    // used to mint the refresh token in the first place, just the
    // refresh_token grant instead of authorization_code.
    const res = await fetch(LWA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken!,
        client_id: clientId!,
        client_secret: clientSecret!,
      }).toString(),
    });
    const body = (await res.json()) as { access_token?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`Amazon Ads connector: LWA token refresh failed (${res.status}): ${JSON.stringify(body)}`);
    }
    this.accessToken = body.access_token;

    // Real connectivity + profile check, same pattern as the Google/Meta
    // connectors' own authenticate() probes -- fails loudly here with a
    // clear reason rather than deep inside fetchRaw().
    const profileRes = await this.request(`/v2/profiles/${profileId}`);
    if (!profileRes.ok) {
      throw new Error(
        `Amazon Ads connector: profile check failed (${profileRes.status}) -- AMAZON_PROFILE_ID/AMAZON_REGION may not match this refresh token. Re-run npm run amazon:auth --workspace server to re-check.`
      );
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "Amazon-Advertising-API-ClientId": env.amazon.clientId!,
      Authorization: `Bearer ${this.accessToken}`,
      "Amazon-Advertising-API-Scope": env.amazon.profileId!,
      ...extra,
    };
  }

  private async request(path: string, init: RequestInit & { extraHeaders?: Record<string, string> } = {}): Promise<Response> {
    const { extraHeaders, ...rest } = init;
    return fetch(`${this.baseUrl}${path}`, { ...rest, headers: this.headers(extraHeaders) });
  }

  /** Sponsored Products daily performance at campaign+ad-group grain, via
   * the async v3 Reporting API (create report -> poll -> download). */
  async fetchRaw(from: string, to: string): Promise<RawRow[]> {
    if (!this.accessToken || !this.baseUrl) {
      throw new Error("Amazon Ads connector: call authenticate() before fetchRaw().");
    }

    const createRes = await this.request("/reporting/reports", {
      method: "POST",
      extraHeaders: { "Content-Type": "application/vnd.createasyncreportrequest.v3+json" },
      body: JSON.stringify({
        name: `fig-ads-dashboard-sp-${from}-${to}`,
        startDate: from,
        endDate: to,
        configuration: {
          adProduct: "SPONSORED_PRODUCTS",
          groupBy: ["campaign", "adGroup"],
          columns: REPORT_COLUMNS,
          reportTypeId: "spCampaigns",
          timeUnit: "DAILY",
          format: "GZIP_JSON",
        },
      }),
    });
    const created = (await createRes.json()) as AmazonCreateReportResponse;
    if (!createRes.ok) {
      throw new Error(`Amazon Ads connector: report creation failed (${createRes.status}): ${JSON.stringify(created)}`);
    }

    let downloadUrl: string | null = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const statusRes = await this.request(`/reporting/reports/${created.reportId}`);
      const status = (await statusRes.json()) as AmazonReportStatusResponse;
      if (status.status === "COMPLETED") {
        downloadUrl = status.url ?? null;
        break;
      }
      if (status.status === "FAILED") {
        throw new Error(`Amazon Ads connector: report ${created.reportId} failed to generate: ${JSON.stringify(status)}`);
      }
    }
    if (!downloadUrl) {
      throw new Error(
        `Amazon Ads connector: report ${created.reportId} did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s.`
      );
    }

    // Pre-signed download URL -- no Ads API auth headers needed/wanted here.
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      throw new Error(`Amazon Ads connector: report download failed (${fileRes.status}).`);
    }
    const rows = (await fileRes.json()) as AmazonReportRow[];
    return rows as unknown as RawRow[];
  }

  async fetchCampaignRoster(): Promise<CampaignRosterEntry[]> {
    if (!this.accessToken || !this.baseUrl) {
      throw new Error("Amazon Ads connector: call authenticate() before fetchCampaignRoster().");
    }

    const res = await this.request("/sp/campaigns/list", {
      method: "POST",
      extraHeaders: { "Content-Type": "application/vnd.spCampaign.v3+json", Accept: "application/vnd.spCampaign.v3+json" },
      body: JSON.stringify({ maxResults: 1000 }),
    });
    const body = (await res.json()) as AmazonCampaignListResponse;
    if (!res.ok) {
      throw new Error(`Amazon Ads connector: campaign list failed (${res.status}): ${JSON.stringify(body)}`);
    }

    return (body.campaigns ?? [])
      .filter((r) => r.state !== "archived")
      .map((r) => ({ campaignId: String(r.campaignId), campaignName: r.name ?? null, status: r.state ?? null }));
  }

  normalize(rows: RawRow[]): CanonicalRowInput[] {
    return (rows as unknown as AmazonReportRow[]).map((row) => ({
      platform: "amazon",
      campaignId: String(row.campaignId),
      campaignName: row.campaignName ?? null,
      adGroupId: row.adGroupId != null ? String(row.adGroupId) : null,
      adGroupName: row.adGroupName ?? null,
      date: row.date,
      spend: Number(row.cost ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      conversions: Number(row.purchases14d ?? 0),
      revenue: Number(row.sales14d ?? 0),
      attributionWindow: ATTRIBUTION_WINDOW_LABEL,
      searchImpressionShare: null, // Google Search-only concept
      searchBudgetLostImpressionShare: null,
      raw: row as unknown as Record<string, unknown>,
    }));
  }
}
