import { GoogleAdsApi, enums, type Customer } from "google-ads-api";
import type { AdsConnector, CampaignRosterEntry, CanonicalRowInput, RawRow } from "@fig/shared";
import { env } from "../config/env";
import type { ProductPerformanceInput, AdPerformanceInput } from "../etl/grainTypes";

// GAQL returns campaign.status as the protobuf enum's numeric code (e.g.
// ENABLED=2, PAUSED=3), not its string name -- confirmed by querying the
// live account and seeing raw "2"/"3" land in dim_campaign.status instead
// of "ENABLED"/"PAUSED". enums.CampaignStatus is a standard TS numeric
// enum, which compiles to a *bidirectional* map (name->code AND
// code->name in the same object), so indexing it with the numeric code
// gives the name back directly.
function campaignStatusName(code: number): string {
  return (enums.CampaignStatus as unknown as Record<number, string>)[code] ?? String(code);
}

// Same numeric-protobuf-enum quirk as campaign.status (see comment above)
// applies to ad_group_ad.status and ad_group_ad.ad.type -- resolve both to
// their string names the same way.
function adGroupAdStatusName(code: number): string {
  return (enums.AdGroupAdStatus as unknown as Record<number, string>)[code] ?? String(code);
}
function adTypeName(code: number): string {
  return (enums.AdType as unknown as Record<number, string>)[code] ?? String(code);
}

// Google Ads reports (segments.date) are bucketed by the *account's own*
// configured timezone, not UTC. If that account timezone isn't IST, a daily
// bucket doesn't line up exactly with an IST calendar day — there's no way
// to fix that retroactively from daily-aggregated rows (would need
// hour-level data). We fetch the account timezone once in authenticate()
// and warn loudly if it's not IST, rather than silently mislabeling dates.
// See spec §5 (normalization layer) for the general timezone rule.
//
// "Asia/Calcutta" is IANA's old (pre-1995 city rename) name for the exact
// same zone as "Asia/Kolkata" — identical offset, identical (lack of) DST —
// and it's what Google Ads actually returns for Indian accounts. Treat both
// as IST; anything else is a real mismatch worth the warning.
const IST_TIMEZONE_NAMES = new Set(["Asia/Kolkata", "Asia/Calcutta"]);

// Field mapping per spec §3: cost_micros/1e6 -> spend, conversions_value ->
// revenue, etc. "google_dda" is the attribution_window label the spec
// prescribes for Google rows (data-driven attribution is Google Ads' default
// conversion model) — it's a label, not a query parameter.
const ATTRIBUTION_WINDOW = "google_dda";

const GAQL_QUERY = (from: string, to: string) => `
  SELECT
    campaign.id,
    campaign.name,
    ad_group.id,
    ad_group.name,
    segments.date,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.conversions_value
  FROM ad_group
  WHERE segments.date BETWEEN '${from}' AND '${to}'
`;

// search_impression_share / search_budget_lost_impression_share are
// fundamentally CAMPAIGN-level-per-day metrics (Search-eligible campaign
// types only -- PMax/Shopping/Display report them as absent/null, which
// normalize() below treats as null, per column spec §6). Querying them
// from `ad_group` like the main query would duplicate a non-additive
// percentage across every ad group in a campaign, which is wrong to then
// SUM() -- kept as a separate campaign-level query instead, merged into
// CanonicalRowInput as synthetic ad_group_id=null rows (zero on every
// additive metric, so they can't skew spend/clicks/etc totals; the API
// layer reads these two columns with MAX() instead of SUM()).
const IMPRESSION_SHARE_QUERY = (from: string, to: string) => `
  SELECT
    campaign.id,
    campaign.name,
    segments.date,
    metrics.search_impression_share,
    metrics.search_budget_lost_impression_share
  FROM campaign
  WHERE segments.date BETWEEN '${from}' AND '${to}'
`;

// Independent of any date range -- ad_group-level performance queries only
// ever return rows for entities with actual activity that day, so a
// paused or simply quiet-this-week campaign is invisible to fetchRaw()
// entirely. This is the full roster instead, straight from the campaign
// resource. REMOVED (deleted) campaigns are excluded; PAUSED ones aren't.
const CAMPAIGN_ROSTER_QUERY = `
  SELECT campaign.id, campaign.name, campaign.status
  FROM campaign
  WHERE campaign.status != 'REMOVED'
`;

// --- product-level (Shopping/PMax) grain -----------------------------------
//
// shopping_performance_view. Separate query, separate table
// (fact_shopping_product_performance) -- see db/migrations/0005 and the
// "Critical modeling rule" in the build spec: this is a different breakdown
// of the SAME campaign spend, never summed with the campaign or ad grain.
const PRODUCT_PERFORMANCE_QUERY = (from: string, to: string) => `
  SELECT
    segments.product_item_id,
    segments.product_title,
    segments.product_brand,
    segments.product_type_l1,
    segments.product_type_l2,
    segments.product_type_l3,
    segments.product_channel,
    campaign.id,
    campaign.name,
    segments.date,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.conversions_value
  FROM shopping_performance_view
  WHERE segments.date BETWEEN '${from}' AND '${to}'
`;

// --- ad-level grain ----------------------------------------------------------
//
// ad_group_ad. Search/Display/Video ad types report here; Shopping/PMax
// campaigns have no rows (they have no traditional "ads" -- their spend
// breakdown lives in the product grain above instead).
const AD_PERFORMANCE_QUERY = (from: string, to: string) => `
  SELECT
    ad_group_ad.ad.id,
    ad_group_ad.ad.name,
    ad_group_ad.ad.type,
    ad_group_ad.status,
    ad_group.id,
    ad_group.name,
    campaign.id,
    campaign.name,
    segments.date,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.conversions_value
  FROM ad_group_ad
  WHERE segments.date BETWEEN '${from}' AND '${to}'
`;

export class GoogleAdsConnector implements AdsConnector {
  platform = "google" as const;

  private client: GoogleAdsApi | null = null;
  private customer: Customer | null = null;
  private accountTimeZone: string | null = null;

  async authenticate(): Promise<void> {
    const { clientId, clientSecret, developerToken, refreshToken, customerId } = env.google;
    const missing = Object.entries({ clientId, clientSecret, developerToken, refreshToken, customerId })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(
        `Google Ads connector: missing env var(s): ${missing.join(", ")}. See .env.example.`
      );
    }

    this.client = new GoogleAdsApi({
      client_id: clientId!,
      client_secret: clientSecret!,
      developer_token: developerToken!,
    });
    this.customer = this.client.Customer({
      customer_id: customerId!,
      refresh_token: refreshToken!,
      // Required when customerId is a client account under a manager (MCC)
      // account — omitted entirely when unset (undefined), which is the
      // correct call shape for a non-MCC-managed account.
      login_customer_id: env.google.loginCustomerId,
    });

    // Doubles as a real connectivity/permission check: this is the first
    // request Google actually sees, so an invalid/no-access token fails
    // here with a clear error rather than deep inside fetchRaw().
    const [row] = await this.customer.query("SELECT customer.time_zone FROM customer LIMIT 1");
    this.accountTimeZone = (row as { customer: { time_zone: string } }).customer.time_zone;

    if (!IST_TIMEZONE_NAMES.has(this.accountTimeZone)) {
      console.warn(
        `[google connector] Ads account timezone is "${this.accountTimeZone}", not IST. ` +
          `Daily date buckets from Google won't line up exactly with IST calendar days — flagging per spec §5 rather than silently mislabeling.`
      );
    }
  }

  async fetchRaw(from: string, to: string): Promise<RawRow[]> {
    if (!this.customer) {
      throw new Error("Google Ads connector: call authenticate() before fetchRaw().");
    }
    const adGroupRows = await this.customer.query(GAQL_QUERY(from, to));

    // Isolated try/catch: impression share is a nice-to-have column, not
    // core performance data -- a failure here (e.g. an account-level
    // permission quirk) shouldn't take down the whole sync the way a
    // failure in the main query should.
    let impressionShareRows: RawRow[] = [];
    try {
      const rows = await this.customer.query(IMPRESSION_SHARE_QUERY(from, to));
      impressionShareRows = (rows as unknown as RawRow[]).map((r) => ({ ...r, _kind: "impression_share" }));
    } catch (err) {
      console.warn("[google connector] impression-share query failed, continuing without it:", err);
    }

    const taggedAdGroupRows = (adGroupRows as unknown as RawRow[]).map((r) => ({ ...r, _kind: "ad_group" }));
    return [...taggedAdGroupRows, ...impressionShareRows];
  }

  async fetchCampaignRoster(): Promise<CampaignRosterEntry[]> {
    if (!this.customer) {
      throw new Error("Google Ads connector: call authenticate() before fetchCampaignRoster().");
    }
    const rows = await this.customer.query(CAMPAIGN_ROSTER_QUERY);
    return (rows as unknown as { campaign: { id: number; name: string; status: number } }[]).map((r) => ({
      campaignId: String(r.campaign.id),
      campaignName: r.campaign.name ?? null,
      status: r.campaign.status != null ? campaignStatusName(r.campaign.status) : null,
    }));
  }

  normalize(rows: RawRow[]): CanonicalRowInput[] {
    return rows.map((r) => {
      if (r._kind === "impression_share") {
        const row = r as unknown as {
          campaign: { id: number; name: string };
          segments: { date: string };
          metrics: {
            search_impression_share?: number | string;
            search_budget_lost_impression_share?: number | string;
          };
        };
        // Synthetic campaign-level row: zero on every additive metric so it
        // can never skew SUM(spend)/SUM(clicks)/etc; ad_group_id null (not
        // any real ad group) so it can't collide with a real ad_group row
        // under the unique index. See IMPRESSION_SHARE_QUERY's comment.
        return {
          platform: "google",
          campaignId: String(row.campaign.id),
          campaignName: row.campaign.name ?? null,
          adGroupId: null,
          adGroupName: null,
          date: row.segments.date,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
          attributionWindow: ATTRIBUTION_WINDOW,
          searchImpressionShare:
            row.metrics.search_impression_share != null ? Number(row.metrics.search_impression_share) : null,
          searchBudgetLostImpressionShare:
            row.metrics.search_budget_lost_impression_share != null
              ? Number(row.metrics.search_budget_lost_impression_share)
              : null,
          raw: row as unknown as Record<string, unknown>,
        };
      }

      const row = r as unknown as {
        campaign: { id: number; name: string };
        ad_group: { id: number; name: string };
        segments: { date: string };
        metrics: {
          cost_micros?: number | string;
          impressions?: number | string;
          clicks?: number | string;
          conversions?: number | string;
          conversions_value?: number | string;
        };
      };

      return {
        platform: "google",
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name ?? null,
        adGroupId: String(row.ad_group.id),
        adGroupName: row.ad_group.name ?? null,
        date: row.segments.date,
        spend: Number(row.metrics.cost_micros ?? 0) / 1e6,
        impressions: Number(row.metrics.impressions ?? 0),
        clicks: Number(row.metrics.clicks ?? 0),
        conversions: Number(row.metrics.conversions ?? 0),
        revenue: Number(row.metrics.conversions_value ?? 0),
        attributionWindow: ATTRIBUTION_WINDOW,
        searchImpressionShare: null,
        searchBudgetLostImpressionShare: null,
        raw: row as unknown as Record<string, unknown>,
      };
    });
  }

  // --- product-level (Shopping/PMax) grain ----------------------------------

  async fetchProductPerformance(from: string, to: string): Promise<RawRow[]> {
    if (!this.customer) {
      throw new Error("Google Ads connector: call authenticate() before fetchProductPerformance().");
    }
    const rows = await this.customer.query(PRODUCT_PERFORMANCE_QUERY(from, to));
    return rows as unknown as RawRow[];
  }

  normalizeProductPerformance(rows: RawRow[]): ProductPerformanceInput[] {
    return rows.map((r) => {
      const row = r as unknown as {
        segments: {
          product_item_id?: string;
          product_title?: string;
          product_brand?: string;
          product_type_l1?: string;
          product_type_l2?: string;
          product_type_l3?: string;
          product_channel?: string;
          date: string;
        };
        campaign: { id: number; name: string };
        metrics: {
          cost_micros?: number | string;
          impressions?: number | string;
          clicks?: number | string;
          conversions?: number | string;
          conversions_value?: number | string;
        };
      };
      return {
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name ?? null,
        // segments.product_item_id can legitimately be absent for a handful
        // of malformed feed rows -- fall back to a stable placeholder
        // rather than dropping the row (spend/impressions are still real).
        productItemId: row.segments.product_item_id ?? "unknown",
        productTitle: row.segments.product_title ?? null,
        productBrand: row.segments.product_brand ?? null,
        productTypeL1: row.segments.product_type_l1 ?? null,
        productTypeL2: row.segments.product_type_l2 ?? null,
        productTypeL3: row.segments.product_type_l3 ?? null,
        productChannel: row.segments.product_channel ?? null,
        date: row.segments.date,
        spend: Number(row.metrics.cost_micros ?? 0) / 1e6,
        impressions: Number(row.metrics.impressions ?? 0),
        clicks: Number(row.metrics.clicks ?? 0),
        conversions: Number(row.metrics.conversions ?? 0),
        revenue: Number(row.metrics.conversions_value ?? 0),
        raw: row as unknown as Record<string, unknown>,
      };
    });
  }

  // --- ad-level grain --------------------------------------------------------

  async fetchAdPerformance(from: string, to: string): Promise<RawRow[]> {
    if (!this.customer) {
      throw new Error("Google Ads connector: call authenticate() before fetchAdPerformance().");
    }
    const rows = await this.customer.query(AD_PERFORMANCE_QUERY(from, to));
    return rows as unknown as RawRow[];
  }

  normalizeAdPerformance(rows: RawRow[]): AdPerformanceInput[] {
    return rows.map((r) => {
      const row = r as unknown as {
        ad_group_ad: {
          ad: { id: number; name?: string; type?: number };
          status?: number;
        };
        ad_group: { id: number; name: string };
        campaign: { id: number; name: string };
        segments: { date: string };
        metrics: {
          cost_micros?: number | string;
          impressions?: number | string;
          clicks?: number | string;
          conversions?: number | string;
          conversions_value?: number | string;
        };
      };
      return {
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name ?? null,
        adGroupId: String(row.ad_group.id),
        adGroupName: row.ad_group.name ?? null,
        adId: String(row.ad_group_ad.ad.id),
        // ad.name is empty for several ad types (e.g. auto-generated RSAs) --
        // null here, UI falls back to id+type per spec §2b.
        adName: row.ad_group_ad.ad.name ?? null,
        adType: row.ad_group_ad.ad.type != null ? adTypeName(row.ad_group_ad.ad.type) : null,
        adStatus: row.ad_group_ad.status != null ? adGroupAdStatusName(row.ad_group_ad.status) : null,
        date: row.segments.date,
        spend: Number(row.metrics.cost_micros ?? 0) / 1e6,
        impressions: Number(row.metrics.impressions ?? 0),
        clicks: Number(row.metrics.clicks ?? 0),
        conversions: Number(row.metrics.conversions ?? 0),
        revenue: Number(row.metrics.conversions_value ?? 0),
        raw: row as unknown as Record<string, unknown>,
      };
    });
  }
}
