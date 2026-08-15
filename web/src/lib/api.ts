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
  ShopifyStatus,
  CompareCampaignsResponse,
  AnomaliesResponse,
  DiagnosticsResponse,
  PortfolioResponse,
  ProductGroupBy,
  MetricsProductsResponse,
  MetricsProductsParetoResponse,
  MetricsAdsResponse,
} from "@fig/shared";

// Local dev: Vite's dev-only proxy rewrites /api -> http://localhost:4000
// (see vite.config.ts) -- that proxy doesn't exist in a production build,
// so the deployed site needs the real backend URL baked in at build time
// via VITE_API_BASE_URL (set as a Vercel env var, pointing at the Railway
// deployment). Falls back to "/api" so local dev needs no env var at all.
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.reason ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
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

export async function triggerSync(platform: Platform, from: string, to: string): Promise<{ status: string; rows: number; error: string | null }> {
  const res = await fetch(`${BASE}/sync/${platform}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

export function fetchShopifyStatus(): Promise<ShopifyStatus> {
  return getJSON(`/shopify/status`);
}

export async function triggerShopifySync(from: string, to: string): Promise<{ status: string; rows: number; error: string | null }> {
  const res = await fetch(`${BASE}/shopify/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

// --- Google Ads: product-level (Shopping/PMax) and ad-level grain ----------

export function fetchProducts(
  from: string,
  to: string,
  groupBy: ProductGroupBy,
  campaignId?: string | null
): Promise<MetricsProductsResponse> {
  const campaignParam = campaignId ? `&campaign_id=${encodeURIComponent(campaignId)}` : "";
  return getJSON(`/metrics/products?from=${from}&to=${to}&group_by=${groupBy}${campaignParam}`);
}

export function fetchProductsPareto(from: string, to: string, campaignId?: string | null): Promise<MetricsProductsParetoResponse> {
  const campaignParam = campaignId ? `&campaign_id=${encodeURIComponent(campaignId)}` : "";
  return getJSON(`/metrics/products/pareto?from=${from}&to=${to}${campaignParam}`);
}

export function fetchAds(from: string, to: string, campaignId?: string | null): Promise<MetricsAdsResponse> {
  const campaignParam = campaignId ? `&campaign_id=${encodeURIComponent(campaignId)}` : "";
  return getJSON(`/metrics/ads?from=${from}&to=${to}${campaignParam}`);
}
