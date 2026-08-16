import { useCallback, useEffect, useMemo, useState } from "react";
import type { Platform, SyncStatusResponse, ShopifyStatus } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { presetRange, type DateRange } from "./lib/dateRanges";
import { type ComparisonMode } from "./lib/comparisonRange";
import { fetchSyncStatus, fetchConfig, fetchShopifyStatus } from "./lib/api";
import { TopBar } from "./components/TopBar";
import { AttributionBanner } from "./components/AttributionBanner";
import { PlatformSidebar, type SidebarSelection } from "./components/PlatformSidebar";
import { PlatformSection } from "./components/PlatformSection";
import { ShopifySection } from "./components/ShopifySection";
import { MetaSkuAttributionSection } from "./components/MetaSkuAttributionSection";
import { MetaCreativePerformanceSection } from "./components/MetaCreativePerformanceSection";
import { SpendFlowBand } from "./components/SpendFlowBand";
import { CommandPalette } from "./components/CommandPalette";
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  // Global ⌘K / Ctrl+K -- works from anywhere in the app, not just while
  // focused on the TopBar's trigger button (spec §7: "the power-user touch").
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const connectedMap = useMemo(() => {
    const map = {} as Record<Platform, boolean>;
    for (const p of ALL_PLATFORMS) {
      map[p] = syncStatus?.platforms.find((s) => s.platform === p)?.connected ?? false;
    }
    return map;
  }, [syncStatus]);

  const isShopify = activeSelection === "shopify";
  const isMetaSkuAttribution = activeSelection === "meta-sku-attribution";
  const isMetaCreativePerformance = activeSelection === "meta-creative-performance";
  const isMetaSubView = isMetaSkuAttribution || isMetaCreativePerformance;
  const lastSync = isShopify
    ? (shopifyStatus?.lastSync ?? null)
    : isMetaSubView
      ? // Derived entirely from Meta + Shopify's already-synced data -- no
        // sync of its own, so "last synced" reuses Meta's.
        (syncStatus?.platforms.find((s) => s.platform === "meta")?.lastSync ?? null)
      : (syncStatus?.platforms.find((s) => s.platform === activeSelection)?.lastSync ?? null);

  function handleSyncComplete() {
    setRefreshKey((k) => k + 1);
    loadSyncStatus();
  }

  // The signature flow band reads as "your whole spend picture" -- shown
  // on every ad-platform page (using the same global range), hidden on
  // Shopify (no ad spend at all) and the two Meta sub-views (already a
  // lens on Meta specifically, one platform of the four this band spans).
  const showSpendFlow = !isShopify && !isMetaSubView;
  const title = isShopify
    ? "Shopify"
    : isMetaSkuAttribution
      ? "Meta Ads — SKU Attribution"
      : isMetaCreativePerformance
        ? "Meta Ads — Creative Performance"
        : PLATFORM_LABELS[activeSelection];

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      <PlatformSidebar
        active={activeSelection}
        onChange={setActiveSelection}
        connected={connectedMap}
        shopifyConnected={shopifyStatus?.connected ?? false}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <TopBar
          title={title}
          lastSync={lastSync}
          syncPulseKey={refreshKey}
          onOpenNav={() => setSidebarOpen(true)}
          grossMargin={grossMargin}
          onGrossMarginChange={setGrossMargin}
          targetRoas={targetRoas}
          onTargetRoasChange={setTargetRoas}
          comparisonMode={comparisonMode}
          onComparisonModeChange={setComparisonMode}
          range={range}
          onRangeChange={setRange}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <main className="min-w-0 flex-1 space-y-4 px-6 py-6">
          {syncStatusError && (
            <div className="animate-fade-slide-in rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
              Can't reach the backend API ({syncStatusError}) — every platform will show as "not connected" until
              it's reachable. Make sure the server is running (<code className="tabular-nums">npm run dev:server</code>).
            </div>
          )}

          {!isShopify && <AttributionBanner />}

          {showSpendFlow && (
            <div className="animate-fade-slide-in" style={{ animationDelay: "40ms" }}>
              <SpendFlowBand
                range={range}
                refreshKey={refreshKey}
                connected={connectedMap}
                activePlatform={activeSelection in connectedMap ? (activeSelection as Platform) : null}
                targetRoas={targetRoas}
                grossMargin={grossMargin}
                onSelectPlatform={setActiveSelection}
              />
            </div>
          )}

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
          ) : isMetaCreativePerformance ? (
            <MetaCreativePerformanceSection key="meta-creative-performance" range={range} refreshKey={refreshKey} />
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

      {paletteOpen && (
        <CommandPalette onNavigate={setActiveSelection} onSetRange={setRange} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}

export default App;
