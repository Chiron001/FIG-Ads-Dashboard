import { useCallback, useEffect, useMemo, useState } from "react";
import type { Platform, SyncStatusResponse } from "@fig/shared";
import { ALL_PLATFORMS } from "@fig/shared";
import { presetRange, type DateRange } from "./lib/dateRanges";
import { fetchSyncStatus } from "./lib/api";
import { DateRangePicker } from "./components/DateRangePicker";
import { AttributionBanner } from "./components/AttributionBanner";
import { PlatformTabs } from "./components/PlatformTabs";
import { PlatformSection } from "./components/PlatformSection";
import "./App.css";

function App() {
  const [range, setRange] = useState<DateRange>(() => presetRange("last7"));
  const [activePlatform, setActivePlatform] = useState<Platform>("google");
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadSyncStatus = useCallback(() => {
    fetchSyncStatus()
      .then(setSyncStatus)
      .catch(() => setSyncStatus(null));
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

  const lastSync = syncStatus?.platforms.find((s) => s.platform === activePlatform)?.lastSync ?? null;

  function handleSyncComplete() {
    setRefreshKey((k) => k + 1);
    loadSyncStatus();
  }

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="sticky top-0 z-10 border-b border-border bg-surface-0/95 backdrop-blur px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-ink-primary">FIG Living — Ads Dashboard</h1>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-secondary">
              All figures in INR
            </span>
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-6 py-6">
        <AttributionBanner />

        <PlatformTabs active={activePlatform} onChange={setActivePlatform} connected={connectedMap} />

        <PlatformSection
          key={activePlatform}
          platform={activePlatform}
          range={range}
          connected={connectedMap[activePlatform]}
          lastSync={lastSync}
          onSyncComplete={handleSyncComplete}
          refreshKey={refreshKey}
        />
      </main>
    </div>
  );
}

export default App;
