import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Platform, SyncStatusResponse, ShopifyStatus } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { presetRange, type DateRange } from "./lib/dateRanges";
import { type ComparisonMode } from "./lib/comparisonRange";
import {
  fetchSyncStatus,
  fetchConfig,
  fetchSettings,
  fetchShopifyStatus,
  triggerSync,
  triggerShopifySync,
  triggerGA4Sync,
  runPredictiveAnalysisForecast,
} from "./lib/api";
import { TopBar } from "./components/TopBar";
import { AttributionBanner } from "./components/AttributionBanner";
import { PlatformSidebar, type SidebarSelection } from "./components/PlatformSidebar";
import { PlatformSection } from "./components/PlatformSection";
import { ShopifySection } from "./components/ShopifySection";
import { HomeSection } from "./components/HomeSection";
import { MetaSkuAttributionSection } from "./components/MetaSkuAttributionSection";
import { MetaCreativePerformanceSection } from "./components/MetaCreativePerformanceSection";
import { GoogleSkuAttributionSection } from "./components/GoogleSkuAttributionSection";
import { ShopifyProductQuadrantsSection } from "./components/ShopifyProductQuadrantsSection";
import { ProjectionSheetSection } from "./components/ProjectionSheetSection";
import { PredictiveAnalysisSection } from "./components/PredictiveAnalysisSection";
import { SettingsSection } from "./components/SettingsSection";
import { SpendFlowBand } from "./components/SpendFlowBand";
import { CommandPalette } from "./components/CommandPalette";
import { applyTheme, getStoredTheme, setStoredTheme, type Theme } from "./lib/theme";
import "./App.css";

// Server-side .env defaults (GROSS_MARGIN/TARGET_ROAS), used only until
// /config resolves -- avoids a flash of "0" in the inputs on first paint.
const FALLBACK_GROSS_MARGIN = 0.6;
const FALLBACK_TARGET_ROAS = 5.5;

function App() {
  const [range, setRange] = useState<DateRange>(() => presetRange("last7"));
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("none");
  const [activeSelection, setActiveSelection] = useState<SidebarSelection>("home");
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [shopifyStatus, setShopifyStatus] = useState<ShopifyStatus | null>(null);
  // Distinct from "syncStatus is null" -- lets the UI tell "server
  // unreachable" apart from "haven't loaded yet", so it never mislabels
  // every platform as not-connected just because the API call itself failed.
  const [syncStatusError, setSyncStatusError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // main.tsx already applied the stored value to <html> before this ever
  // mounts (no flash) -- this state exists so the sidebar toggle has
  // something to read/drive; re-applying on change is what actually
  // updates the page.
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  function handleThemeChange(next: Theme) {
    setTheme(next);
    setStoredTheme(next);
    applyTheme(next);
  }

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

  // Whether the Home page's AI box can actually answer -- re-checked every
  // time Home becomes active (not just once on mount) so saving a key on
  // the Settings page and navigating back to Home picks it up without a
  // full reload.
  const [aiConfigured, setAiConfigured] = useState(false);
  useEffect(() => {
    if (activeSelection !== "home") return;
    fetchSettings()
      .then((s) => setAiConfigured(s.settings.anthropicApiKeyConfigured))
      .catch(() => {});
  }, [activeSelection]);

  // Distinct from syncStatus/shopifyStatus themselves being non-null --
  // those stay null on a failed fetch (see the catch handlers below), so
  // "is either non-null yet" can't tell "still loading" apart from "loaded
  // and it failed." The auto-sync-on-load effect needs the latter case too
  // (nothing connected, so there's nothing to sync -- not "wait forever").
  const [statusLoaded, setStatusLoaded] = useState(false);

  const loadSyncStatus = useCallback(() => {
    fetchSyncStatus()
      .then((s) => {
        setSyncStatus(s);
        setSyncStatusError(null);
      })
      .catch((err) => {
        setSyncStatus(null);
        setSyncStatusError(String(err?.message ?? err));
      })
      .finally(() => setStatusLoaded(true));
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

  // Syncs every connected platform (ad platforms + Shopify) for the current
  // top-bar date range in one go -- same range each platform's own local
  // "Sync now" button already uses, just fired for all of them at once
  // instead of one at a time. Promise.allSettled, not .all: one platform's
  // API hiccup shouldn't abort the others still in flight. Not wrapped in
  // useCallback's usual guard against "nothing connected" being a silent
  // no-op -- it already is one, syncingAll just never flips true.
  const [syncingAll, setSyncingAll] = useState(false);
  const handleSyncAll = useCallback(async () => {
    const adPlatforms = ALL_PLATFORMS.filter((p) => connectedMap[p]);
    const syncShopify = shopifyStatus?.connected ?? false;
    if (adPlatforms.length === 0 && !syncShopify) return;

    setSyncingAll(true);
    try {
      // GA4 always attempted (not gated on a tracked "connected" flag the
      // way ad platforms/Shopify are) -- runGA4Sync already fails gracefully
      // into sync_log if it isn't configured, same as any other platform
      // would if its credentials were missing, and Promise.allSettled
      // tolerates it either way. Fixed 90-day window, not the top-bar's
      // range -- GA4 here feeds the forecast's training history, not
      // whatever short range happens to be selected for viewing.
      const ga4From = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const ga4To = new Date().toISOString().slice(0, 10);
      await Promise.allSettled([
        ...adPlatforms.map((p) => triggerSync(p, range.from, range.to)),
        ...(syncShopify ? [triggerShopifySync(range.from, range.to)] : []),
        triggerGA4Sync(ga4From, ga4To),
      ]);
      // Piggybacked onto "Sync all" rather than a separate scheduler --
      // see PredictiveAnalysisResponse's header comment in shared/src/index.ts.
      await runPredictiveAnalysisForecast().catch(() => {});
    } finally {
      setSyncingAll(false);
      setRefreshKey((k) => k + 1);
      loadSyncStatus();
    }
  }, [connectedMap, shopifyStatus, range.from, range.to, loadSyncStatus]);

  // Fires exactly once per page load, as soon as we know which platforms
  // are actually connected (statusLoaded, not just syncStatus/shopifyStatus
  // being non-null -- see its own comment) -- "auto sync whenever the
  // dashboard is loading," so the analyst never has to remember to click
  // Sync on every platform by hand before trusting what's on screen.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (!statusLoaded || autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    handleSyncAll();
  }, [statusLoaded, handleSyncAll]);

  const isHome = activeSelection === "home";
  const isShopify = activeSelection === "shopify";
  const isMetaSkuAttribution = activeSelection === "meta-sku-attribution";
  const isMetaCreativePerformance = activeSelection === "meta-creative-performance";
  const isGoogleSkuAttribution = activeSelection === "google-sku-attribution";
  const isShopifyProductQuadrants = activeSelection === "shopify-product-quadrants";
  const isShopifyProjectionSheet = activeSelection === "shopify-projection-sheet";
  const isShopifyPredictiveAnalysis = activeSelection === "shopify-predictive-analysis";
  const isSettings = activeSelection === "settings";
  const isMetaSubView = isMetaSkuAttribution || isMetaCreativePerformance;
  const lastSync = isHome || isSettings
    ? null // Home has no sync of its own (reads already-synced data); Settings is app-wide config, not synced data
    : isShopify || isShopifyProductQuadrants || isShopifyProjectionSheet || isShopifyPredictiveAnalysis
      ? (shopifyStatus?.lastSync ?? null)
      : isMetaSubView
        ? // Derived entirely from Meta + Shopify's already-synced data -- no
          // sync of its own, so "last synced" reuses Meta's.
          (syncStatus?.platforms.find((s) => s.platform === "meta")?.lastSync ?? null)
        : isGoogleSkuAttribution
          ? (syncStatus?.platforms.find((s) => s.platform === "google")?.lastSync ?? null)
          : (syncStatus?.platforms.find((s) => s.platform === activeSelection)?.lastSync ?? null);

  function handleSyncComplete() {
    setRefreshKey((k) => k + 1);
    loadSyncStatus();
  }

  function handleApplyDateAndComparison(nextRange: DateRange, nextComparisonMode: ComparisonMode) {
    setRange(nextRange);
    setComparisonMode(nextComparisonMode);
  }

  // The signature flow band reads as "your whole spend picture" -- shown
  // on every ad-platform page (using the same global range), hidden on
  // Shopify (no ad spend at all) and the two Meta sub-views (already a
  // lens on Meta specifically, one platform of the four this band spans).
  const showSpendFlow =
    !isHome &&
    !isShopify &&
    !isMetaSubView &&
    !isGoogleSkuAttribution &&
    !isShopifyProductQuadrants &&
    !isShopifyProjectionSheet &&
    !isShopifyPredictiveAnalysis &&
    !isSettings;
  const title = isHome
    ? "Home"
    : isSettings
      ? "Settings"
      : isShopify
      ? "Shopify"
      : isShopifyProductQuadrants
        ? "Shopify — Product Quadrants"
        : isShopifyProjectionSheet
          ? "Shopify — Projection Sheet"
          : isShopifyPredictiveAnalysis
            ? "Shopify — Predictive Analysis"
            : isMetaSkuAttribution
              ? "Meta Ads — SKU Attribution"
              : isMetaCreativePerformance
                ? "Meta Ads — Creative Performance"
                : isGoogleSkuAttribution
                  ? "Google Ads — SKU Attribution"
                  : PLATFORM_LABELS[activeSelection as Platform];

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      <PlatformSidebar
        active={activeSelection}
        onChange={setActiveSelection}
        connected={connectedMap}
        shopifyConnected={shopifyStatus?.connected ?? false}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        theme={theme}
        onThemeChange={handleThemeChange}
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
          range={range}
          onApplyDateAndComparison={handleApplyDateAndComparison}
          onOpenPalette={() => setPaletteOpen(true)}
          onSyncAll={handleSyncAll}
          syncingAll={syncingAll}
        />

        <main className="min-w-0 flex-1 space-y-4 px-6 py-6">
          {syncStatusError && (
            <div className="animate-fade-slide-in rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
              Can't reach the backend API ({syncStatusError}) — every platform will show as "not connected" until
              it's reachable. Make sure the server is running (<code className="tabular-nums">npm run dev:server</code>).
            </div>
          )}

          {!isHome &&
            !isShopify &&
            !isShopifyProductQuadrants &&
            !isShopifyProjectionSheet &&
            !isShopifyPredictiveAnalysis &&
            !isSettings &&
            !isGoogleSkuAttribution && <AttributionBanner />}

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

          {isHome ? (
            <HomeSection aiConfigured={aiConfigured} onGoToSettings={() => setActiveSelection("settings")} />
          ) : isSettings ? (
            <SettingsSection key="settings" range={range} />
          ) : isShopify ? (
            <ShopifySection
              key="shopify"
              range={range}
              connected={shopifyStatus?.connected ?? false}
              lastSync={lastSync}
              onSyncComplete={handleSyncComplete}
              refreshKey={refreshKey}
              targetRoas={targetRoas}
              comparisonMode={comparisonMode}
            />
          ) : isShopifyProductQuadrants ? (
            <ShopifyProductQuadrantsSection
              key="shopify-product-quadrants"
              range={range}
              connected={shopifyStatus?.connected ?? false}
              refreshKey={refreshKey}
              targetRoas={targetRoas}
            />
          ) : isShopifyProjectionSheet ? (
            <ProjectionSheetSection key="shopify-projection-sheet" connected={shopifyStatus?.connected ?? false} />
          ) : isShopifyPredictiveAnalysis ? (
            <PredictiveAnalysisSection key="shopify-predictive-analysis" />
          ) : isMetaSkuAttribution ? (
            <MetaSkuAttributionSection key="meta-sku-attribution" range={range} refreshKey={refreshKey} targetRoas={targetRoas} />
          ) : isMetaCreativePerformance ? (
            <MetaCreativePerformanceSection key="meta-creative-performance" range={range} refreshKey={refreshKey} targetRoas={targetRoas} />
          ) : isGoogleSkuAttribution ? (
            <GoogleSkuAttributionSection key="google-sku-attribution" range={range} refreshKey={refreshKey} targetRoas={targetRoas} />
          ) : (
            // Every non-Platform SidebarSelection is handled by a branch
            // above -- what's left here is always a real Platform, this
            // cast just tells TS what the isX flags already guarantee.
            <PlatformSection
              key={activeSelection}
              platform={activeSelection as Platform}
              range={range}
              connected={connectedMap[activeSelection as Platform]}
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
