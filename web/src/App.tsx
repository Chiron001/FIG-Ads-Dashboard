import { useCallback, useEffect, useMemo, useState } from "react";
import type { Platform, SyncStatusResponse } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import { presetRange, type DateRange } from "./lib/dateRanges";
import { fetchSyncStatus } from "./lib/api";
import { DateRangePicker } from "./components/DateRangePicker";
import { AttributionBanner } from "./components/AttributionBanner";
import { PlatformSidebar } from "./components/PlatformSidebar";
import { PlatformSection } from "./components/PlatformSection";
import "./App.css";

function App() {
  const [range, setRange] = useState<DateRange>(() => presetRange("last7"));
  const [activePlatform, setActivePlatform] = useState<Platform>("google");
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  // Distinct from "syncStatus is null" -- lets the UI tell "server
  // unreachable" apart from "haven't loaded yet", so it never mislabels
  // every platform as not-connected just because the API call itself failed.
  const [syncStatusError, setSyncStatusError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
    <div className="flex min-h-screen bg-surface-0">
      <PlatformSidebar active={activePlatform} onChange={setActivePlatform} connected={connectedMap} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface-0/95 px-6 py-3.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-primary">{PLATFORM_LABELS[activePlatform]}</h2>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-secondary">
              All figures in INR
            </span>
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </header>

        <main className="min-w-0 flex-1 space-y-4 px-6 py-6">
          {syncStatusError && (
            <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
              Can't reach the backend API ({syncStatusError}) — every platform will show as "not connected" until
              it's reachable. Make sure the server is running (<code className="tabular-nums">npm run dev:server</code>).
            </div>
          )}

          <AttributionBanner />

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
    </div>
  );
}

export default App;
