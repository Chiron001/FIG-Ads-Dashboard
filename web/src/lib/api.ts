import type {
  MetricsSummaryResponse,
  MetricsTimeseriesResponse,
  MetricsCampaignsResponse,
  SyncStatusResponse,
  Platform,
  TimeseriesMetric,
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

export async function triggerSync(platform: Platform, from: string, to: string): Promise<{ status: string; rows: number; error: string | null }> {
  const res = await fetch(`${BASE}/sync/${platform}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  return res.json();
}
