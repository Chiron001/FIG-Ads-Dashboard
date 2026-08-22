import { BetaAnalyticsDataClient, protos } from "@google-analytics/data";
import { env } from "../config/env";
import { extractProductHandle, resolveCanonicalHandle, fetchHandleRedirectMap } from "./shopify";

// GA4 Data API -- channel/session cross-check, separate from Shopify's own
// live-only ShopifyQL session data (see db/migrations/0007's header). Unlike
// that, GA4 report rows ARE stored historically (fact_ga4_channel_daily,
// once built) since forecasting needs a real time series, not a per-request
// range total.

export interface GA4DailyChannelRow {
  date: string; // YYYY-MM-DD
  channelGroup: string; // GA4's own default channel grouping, e.g. "Paid Search", "Paid Social", "Direct", "Organic Search"
  sessions: number;
  conversions: number;
  totalRevenue: number;
  transactions: number;
}

let client: BetaAnalyticsDataClient | null = null;

function getClient(): BetaAnalyticsDataClient {
  if (client) return client;
  if (!env.ga4.serviceAccountKey) {
    throw new Error("GA4 not configured -- missing GA4_SERVICE_ACCOUNT_KEY_BASE64 in .env.");
  }
  client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: env.ga4.serviceAccountKey.client_email,
      private_key: env.ga4.serviceAccountKey.private_key,
    },
  });
  return client;
}

function cellValue(row: protos.google.analytics.data.v1beta.IRow, index: number, kind: "dimension" | "metric"): string {
  const values = kind === "dimension" ? row.dimensionValues : row.metricValues;
  return values?.[index]?.value ?? "";
}

/** Daily sessions/conversions/revenue by GA4's default channel group, for a
 * date range (YYYY-MM-DD, inclusive). Throws if GA4 isn't configured or the
 * property/credentials are invalid -- callers decide how to handle that
 * (e.g. sync routes report it as a failed sync, not a silent empty result). */
export async function fetchGA4DailyChannelData(from: string, to: string): Promise<GA4DailyChannelRow[]> {
  if (!env.ga4.propertyId) {
    throw new Error("GA4 not configured -- missing GA4_PROPERTY_ID in .env.");
  }
  const analyticsDataClient = getClient();
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${env.ga4.propertyId}`,
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }, { name: "transactions" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 100000,
  });

  return (response.rows ?? []).map((row) => {
    const rawDate = cellValue(row, 0, "dimension"); // GA4 returns "YYYYMMDD", no separators
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    return {
      date,
      channelGroup: cellValue(row, 1, "dimension"),
      sessions: Number(cellValue(row, 0, "metric")) || 0,
      conversions: Number(cellValue(row, 1, "metric")) || 0,
      totalRevenue: Number(cellValue(row, 2, "metric")) || 0,
      transactions: Number(cellValue(row, 3, "metric")) || 0,
    };
  });
}

// --- per-product sessions by ad platform (Google/Meta), replacing the old
// ShopifyQL utm_source guess -----------------------------------------------
//
// GA4's sessionDefaultChannelGroup is a real classification (browser-side
// event data, GA4's own channel model), not a regex match against whatever
// string a campaign happened to tag utm_source with -- more accurate, per
// explicit request, for exactly the fields that used to rely on the guess
// (Shopify page's Google/Meta Sessions KPIs, Products/Product Quadrants'
// per-product session-and-CVR columns, Projection Sheet's mtdGoogleSessions/
// mtdMetaSessions). "Paid Search" = Google Ads, "Paid Social" = Meta Ads --
// true for this account specifically since Google + Meta are the only two
// paid platforms connected (confirmed live: no other paid channel group has
// meaningful volume). Not stored (unlike fetchGA4DailyChannelData) -- same
// "live per-request, not worth a storage layer" call as Shopify's own
// per-product session queries, since this is keyed by product×date-range,
// not a fixed daily grain.

const GOOGLE_ADS_CHANNEL_GROUP = "Paid Search";
const META_ADS_CHANNEL_GROUP = "Paid Social";

interface GA4PageSessionsRow {
  pagePath: string;
  sessions: number;
}

async function fetchGA4SessionsByPageForChannel(channelGroup: string, from: string, to: string): Promise<GA4PageSessionsRow[]> {
  if (!env.ga4.propertyId) {
    throw new Error("GA4 not configured -- missing GA4_PROPERTY_ID in .env.");
  }
  const analyticsDataClient = getClient();
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${env.ga4.propertyId}`,
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: {
      filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: channelGroup } },
    },
    limit: 10000,
  });
  return (response.rows ?? []).map((row) => ({
    pagePath: cellValue(row, 0, "dimension"),
    sessions: Number(cellValue(row, 0, "metric")) || 0,
  }));
}

/** Per-product session counts for the range, split by ad platform, keyed by
 * product handle (canonicalized through the same handle-redirect chain
 * Shopify's own per-product session queries use -- a session recorded
 * against a product's OLD handle must still count toward that product, not
 * silently disappear after a rename). Throws if GA4 isn't configured;
 * callers wrap this in their own try/catch "safe" fallback, same convention
 * as every other per-product session fetch in this app. */
export async function fetchGA4ProductSessionsByPlatform(from: string, to: string): Promise<{ google: Map<string, number>; meta: Map<string, number> }> {
  const [googleRows, metaRows, redirects] = await Promise.all([
    fetchGA4SessionsByPageForChannel(GOOGLE_ADS_CHANNEL_GROUP, from, to),
    fetchGA4SessionsByPageForChannel(META_ADS_CHANNEL_GROUP, from, to),
    fetchHandleRedirectMap(),
  ]);

  const buildMap = (rows: GA4PageSessionsRow[]): Map<string, number> => {
    const byHandle = new Map<string, number>();
    for (const row of rows) {
      const rawHandle = extractProductHandle(row.pagePath);
      if (!rawHandle) continue;
      const handle = resolveCanonicalHandle(rawHandle, redirects);
      byHandle.set(handle, (byHandle.get(handle) ?? 0) + row.sessions);
    }
    return byHandle;
  };

  return { google: buildMap(googleRows), meta: buildMap(metaRows) };
}
