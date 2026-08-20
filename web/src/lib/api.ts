import type {
  MetricsSummaryResponse,
  MetricsTimeseriesResponse,
  MetricsCampaignsResponse,
  SyncStatusResponse,
  Platform,
  TimeseriesMetric,
  AppConfig,
  ShopifySummaryResponse,
  ShopifyProductsResponse,
  ProductQuadrantsResponse,
  ShopifyStatus,
  CompareCampaignsResponse,
  AnomaliesResponse,
  DiagnosticsResponse,
  PortfolioResponse,
  ProductGroupBy,
  GrainPlatform,
  MetricsProductsResponse,
  MetricsProductsParetoResponse,
  MetricsAdsResponse,
  MetaSkuAttributionResponse,
  GoogleSkuAttributionResponse,
  MetaCreativePerformanceResponse,
  SettingsResponse,
  AdditionalCost,
  ProjectionResponse,
  ProjectionUpdateEntry,
  AiAskResponse,
  AiQueryHistoryResponse,
} from "@fig/shared";
import { getStoredPassword } from "./sitePassword";

// Local dev: Vite's dev-only proxy rewrites /api -> http://localhost:4000
// (see vite.config.ts) -- that proxy doesn't exist in a production build,
// so the deployed site needs the real backend URL baked in at build time
// via VITE_API_BASE_URL (set as a Vercel env var, pointing at the Railway
// deployment). Falls back to "/api" so local dev needs no env var at all.
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

// Whole-site password gate -- every request carries whatever's currently
// stored (see lib/sitePassword.ts), including "" before it's ever been
// entered; the server just 401s that case like any other mismatch. One
// header builder shared by every fetch call below so there's a single place
// this attaches, not one per call site.
function authHeaders(): Record<string, string> {
  return { "X-Site-Password": getStoredPassword() ?? "" };
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.reason ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function patchJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error ?? errBody.reason ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Validates a CANDIDATE password (not necessarily the stored one) against
 * the server -- used by the password gate both for the initial form
 * submission and to silently revalidate a stored value on reload. Doesn't
 * throw on 401 -- that's an expected "wrong password" outcome, not an error. */
export async function checkSitePassword(candidate: string): Promise<boolean> {
  const res = await fetch(`${BASE}/auth/check`, { headers: { "X-Site-Password": candidate } });
  return res.ok;
}

export function fetchSummary(from: string, to: string, platforms: Platform[]): Promise<MetricsSummaryResponse> {
  return getJSON(`/metrics/summary?from=${from}&to=${to}&platforms=${platforms.join(",")}`);
}

export function fetchTimeseries(
  from: string,
  to: string,
  platforms: Platform[],
  metric: TimeseriesMetric
): Promise<MetricsTimeseriesResponse> {
  return getJSON(`/metrics/timeseries?from=${from}&to=${to}&platforms=${platforms.join(",")}&metric=${metric}`);
}

export function fetchCampaigns(from: string, to: string, platform: Platform): Promise<MetricsCampaignsResponse> {
  return getJSON(`/metrics/campaigns?from=${from}&to=${to}&platform=${platform}`);
}

export function fetchSyncStatus(): Promise<SyncStatusResponse> {
  return getJSON(`/sync/status`);
}

export function fetchConfig(): Promise<AppConfig> {
  return getJSON(`/config`);
}

// Deliberately NOT postJSON -- a failed sync responds 502 with a real
// {status,rows,error} body the caller reads, not something to throw away in
// favor of a generic exception (matches the pre-existing behavior here,
// only the auth header is new).
export async function triggerSync(platform: Platform, from: string, to: string): Promise<{ status: string; rows: number; error: string | null }> {
  const res = await fetch(`${BASE}/sync/${platform}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ from, to }),
  });
  return res.json();
}

export function fetchShopifySummary(from: string, to: string): Promise<ShopifySummaryResponse> {
  return getJSON(`/shopify/summary?from=${from}&to=${to}`);
}

export function fetchShopifyProducts(from: string, to: string): Promise<ShopifyProductsResponse> {
  return getJSON(`/shopify/products?from=${from}&to=${to}`);
}

export function fetchShopifyProductQuadrants(from: string, to: string): Promise<ProductQuadrantsResponse> {
  return getJSON(`/shopify/product-quadrants?from=${from}&to=${to}`);
}

export function fetchShopifyStatus(): Promise<ShopifyStatus> {
  return getJSON(`/shopify/status`);
}

export async function triggerShopifySync(from: string, to: string): Promise<{ status: string; rows: number; error: string | null }> {
  const res = await fetch(`${BASE}/shopify/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ from, to }),
  });
  return res.json();
}

export function fetchCompareCampaigns(
  platform: Platform,
  from: string,
  to: string,
  campaignA: string,
  campaignB: string
): Promise<CompareCampaignsResponse> {
  return getJSON(
    `/stats/compare?platform=${platform}&from=${from}&to=${to}&campaignA=${encodeURIComponent(campaignA)}&campaignB=${encodeURIComponent(campaignB)}`
  );
}

export function fetchAnomalies(platform: Platform, from: string, to: string, campaignId: string): Promise<AnomaliesResponse> {
  return getJSON(`/stats/anomalies?platform=${platform}&from=${from}&to=${to}&campaignId=${encodeURIComponent(campaignId)}`);
}

export function fetchDiagnostics(
  platform: Platform,
  from: string,
  to: string,
  campaignId: string,
  grossMargin: number
): Promise<DiagnosticsResponse> {
  return getJSON(
    `/stats/diagnostics?platform=${platform}&from=${from}&to=${to}&campaignId=${encodeURIComponent(campaignId)}&grossMargin=${grossMargin}`
  );
}

export function fetchPortfolio(platform: Platform, from: string, to: string, grossMargin: number): Promise<PortfolioResponse> {
  return getJSON(`/stats/portfolio?platform=${platform}&from=${from}&to=${to}&grossMargin=${grossMargin}`);
}

// --- product-level and ad-level grain (Google + Meta) -----------------------

export function fetchProducts(
  platform: GrainPlatform,
  from: string,
  to: string,
  groupBy: ProductGroupBy,
  campaignId?: string | null
): Promise<MetricsProductsResponse> {
  const campaignParam = campaignId ? `&campaign_id=${encodeURIComponent(campaignId)}` : "";
  return getJSON(`/metrics/products?platform=${platform}&from=${from}&to=${to}&group_by=${groupBy}${campaignParam}`);
}

export function fetchProductsPareto(
  platform: GrainPlatform,
  from: string,
  to: string,
  campaignId?: string | null
): Promise<MetricsProductsParetoResponse> {
  const campaignParam = campaignId ? `&campaign_id=${encodeURIComponent(campaignId)}` : "";
  return getJSON(`/metrics/products/pareto?platform=${platform}&from=${from}&to=${to}${campaignParam}`);
}

export function fetchAds(platform: GrainPlatform, from: string, to: string, campaignId?: string | null): Promise<MetricsAdsResponse> {
  const campaignParam = campaignId ? `&campaign_id=${encodeURIComponent(campaignId)}` : "";
  return getJSON(`/metrics/ads?platform=${platform}&from=${from}&to=${to}${campaignParam}`);
}

// --- Meta SKU attribution (Ads ROAS vs Website ROAS) ------------------------

export function fetchMetaSkuAttribution(from: string, to: string): Promise<MetaSkuAttributionResponse> {
  return getJSON(`/meta-sku-attribution?from=${from}&to=${to}`);
}

export function fetchGoogleSkuAttribution(from: string, to: string): Promise<GoogleSkuAttributionResponse> {
  return getJSON(`/google-sku-attribution?from=${from}&to=${to}`);
}

// --- Meta Creative Performance (per-creative $...$ tag breakdown) ----------

export function fetchMetaCreativePerformance(from: string, to: string): Promise<MetaCreativePerformanceResponse> {
  return getJSON(`/meta-creative-performance?from=${from}&to=${to}`);
}

// --- Settings (API integrations status, COGS %, EBITDA cost inputs) --------

export function fetchSettings(): Promise<SettingsResponse> {
  return getJSON(`/settings`);
}

export function updateSettings(body: { cogsRate?: number; additionalCosts?: AdditionalCost[]; anthropicApiKey?: string }): Promise<SettingsResponse> {
  return patchJSON(`/settings`, body);
}

// --- Projection Sheet (monthly unit targets vs. actual pace) ---------------

export function fetchProjection(): Promise<ProjectionResponse> {
  return getJSON(`/projection`);
}

export function updateProjection(updates: ProjectionUpdateEntry[]): Promise<{ ok: boolean }> {
  return patchJSON(`/projection`, { updates });
}

// --- AI Home ("ask anything") -----------------------------------------------

export async function askAi(question: string): Promise<AiAskResponse> {
  const res = await fetch(`${BASE}/ai/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ question }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // not_configured is a distinct, expected case (see routes/ai.ts) -- the
    // message is written to be shown to the user directly, not a generic
    // "request failed".
    throw new Error(body.message ?? body.error ?? `${res.status} ${res.statusText}`);
  }
  return body;
}

export function fetchAiHistory(): Promise<AiQueryHistoryResponse> {
  return getJSON(`/ai/history`);
}
