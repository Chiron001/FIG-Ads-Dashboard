import { useCallback, useEffect, useMemo, useState } from "react";
import type { Platform, SyncStatusResponse, ShopifyStatus } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { presetRange, type DateRange } from "./lib/dateRanges";
import { COMPARISON_LABELS, COMPARISON_MODE_ORDER, type ComparisonMode } from "./lib/comparisonRange";
import { fetchSyncStatus, fetchConfig, fetchShopifyStatus } from "./lib/api";
import { DateRangePicker } from "./components/DateRangePicker";
import { AttributionBanner } from "./components/AttributionBanner";
import { PlatformSidebar, type SidebarSelection } from "./components/PlatformSidebar";
import { PlatformSection } from "./components/PlatformSection";
import { ShopifySection } from "./components/ShopifySection";
import { MetaSkuAttributionSection } from "./components/MetaSkuAttributionSection";
import "./App.css";

// Server-side .env defaults (GROSS_MARGIN/TARGET_ROAS), used only until
// /config resolves -- avoids a flash of "0" in the inputs on first paint.
const FALLBACK_GROSS_MARGIN = 0.6;
const FALLBACK_TARGET_ROAS = 4;

function App() {
  const [range, setRange] = useState<DateRange>(() => presetRange("last7"));
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("none");
  const [activeSelection, setActiveSelection] = useState<SidebarSelection>("google");
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [shopifyStatus, setShopifyStatus] = useState<ShopifyStatus | null>(null);
  // Distinct from "syncStatus is null" -- lets the UI tell "server
  // unreachable" apart from "haven't loaded yet", so it never mislabels
  // every platform as not-connected just because the API call itself failed.
  const [syncStatusError, setSyncStatusError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Campaign-table economics -- fetched once as a starting point, then
  // live-editable from the top bar (spec: "expose it as an editable field
  // ... so the analyst can flip it and watch Profit / Break-even ROAS
  // recompute live"). No localStorage -- resets to the server default on reload.
  const [grossMargin, setGrossMargin] = useState(FALLBACK_GROSS_MARGIN);
  const [targetRoas, setTargetRoas] = useState(FALLBACK_TARGET_ROAS);

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setGrossMargin(c.grossMargin);
        setTargetRoas(c.targetRoas);
      })
      .catch(() => {
        /* keep fallback defaults -- not worth a banner over a config nicety */
      });
  }, []);

  const loadSyncStatus = useCallback(() => {
    fetchSyncStatus()
      .then((s) => {
        setSyncStatus(s);
        setSyncStatusError(null);
      })
      .catch((err) => {
        setSyncStatus(null);
        setSyncStatusError(String(err?.message ?? err));
      });
    fetchShopifyStatus()
      .then(setShopifyStatus)
      .catch(() => setShopifyStatus(null));
  }, []);

  useEffect(() => {
    loadSyncStatus();
  }, [loadSyncStatus]);

  const connectedMap = useMemo(() => {
    const map = {} as Record<Platform, boolean>;
    for (const p of ALL_PLATFORMS) {
      map[p] = syncStatus?.platforms.find((s) => s.platform === p)?.connected ?? false;
    }
    return map;
  }, [syncStatus]);

  const isShopify = activeSelection === "shopify";
  const isMetaSkuAttribution = activeSelection === "meta-sku-attribution";
  const lastSync = isShopify
    ? (shopifyStatus?.lastSync ?? null)
    : isMetaSkuAttribution
      ? // Derived entirely from Meta + Shopify's already-synced data -- no
        // sync of its own, so "last synced" reuses Meta's.
        (syncStatus?.platforms.find((s) => s.platform === "meta")?.lastSync ?? null)
      : (syncStatus?.platforms.find((s) => s.platform === activeSelection)?.lastSync ?? null);

  function handleSyncComplete() {
    setRefreshKey((k) => k + 1);
    loadSyncStatus();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      <PlatformSidebar
        active={activeSelection}
        onChange={setActiveSelection}
        connected={connectedMap}
        shopifyConnected={shopifyStatus?.connected ?? false}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-0/95 px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-primary">
              {isShopify ? "Shopify" : isMetaSkuAttribution ? "Meta Ads — SKU Attribution" : PLATFORM_LABELS[activeSelection]}
            </h2>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-secondary">
              All figures in INR
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-ink-secondary">
              <label className="flex items-center gap-1.5" title="Blended gross margin -- drives Profit and Break-even ROAS on the campaign table">
                Margin
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={Math.round(grossMargin * 100)}
                  onChange={(e) => setGrossMargin(Math.max(1, Math.min(100, Number(e.target.value) || 0)) / 100)}
                  className="w-14 rounded-md border border-border bg-surface-1 px-1.5 py-1 text-right tabular-nums text-ink-primary"
                />
                %
              </label>
              <label className="flex items-center gap-1.5" title="Target ROAS -- drives the Scale/Maintain/Review verdict thresholds">
                Target ROAS
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={targetRoas}
                  onChange={(e) => setTargetRoas(Math.max(0, Number(e.target.value) || 0))}
                  className="w-14 rounded-md border border-border bg-surface-1 px-1.5 py-1 text-right tabular-nums text-ink-primary"
                />
                x
              </label>
            </div>
            <select
              value={comparisonMode}
              onChange={(e) => setComparisonMode(e.target.value as ComparisonMode)}
              title="Compare KPIs against another period"
              className="rounded-md border border-border bg-surface-1 px-2.5 py-2 text-sm text-ink-secondary"
            >
              {COMPARISON_MODE_ORDER.map((mode) => (
                <option key={mode} value={mode}>
                  {COMPARISON_LABELS[mode]}
                </option>
              ))}
            </select>
            <DateRangePicker value={range} onChange={setRange} />
          </div>
        </header>

        <main className="min-w-0 flex-1 space-y-4 px-6 py-6">
          {syncStatusError && (
            <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
              Can't reach the backend API ({syncStatusError}) — every platform will show as "not connected" until
              it's reachable. Make sure the server is running (<code className="tabular-nums">npm run dev:server</code>).
            </div>
          )}

          {!isShopify && <AttributionBanner />}

          {isShopify ? (
            <ShopifySection
              key="shopify"
              range={range}
              connected={shopifyStatus?.connected ?? false}
              lastSync={lastSync}
              onSyncComplete={handleSyncComplete}
              refreshKey={refreshKey}
            />
          ) : isMetaSkuAttribution ? (
            <MetaSkuAttributionSection key="meta-sku-attribution" range={range} refreshKey={refreshKey} />
          ) : (
            <PlatformSection
              key={activeSelection}
              platform={activeSelection}
              range={range}
              connected={connectedMap[activeSelection]}
              lastSync={lastSync}
              onSyncComplete={handleSyncComplete}
              refreshKey={refreshKey}
              grossMargin={grossMargin}
              targetRoas={targetRoas}
              comparisonMode={comparisonMode}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
