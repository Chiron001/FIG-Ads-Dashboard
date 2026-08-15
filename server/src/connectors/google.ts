import { GoogleAdsApi, type Customer } from "google-ads-api";
import type { AdsConnector, CanonicalRowInput, RawRow } from "@fig/shared";
import { env } from "../config/env";

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
    const rows = await this.customer.query(GAQL_QUERY(from, to));
    return rows as unknown as RawRow[];
  }

  normalize(rows: RawRow[]): CanonicalRowInput[] {
    return rows.map((r) => {
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
        raw: row as unknown as Record<string, unknown>,
      };
    });
  }
}
