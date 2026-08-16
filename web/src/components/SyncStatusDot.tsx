import { useEffect, useState } from "react";
import type { SyncLogEntry } from "@fig/shared";
import { formatRelativeTime } from "../lib/relativeTime";

interface Props {
  lastSync: SyncLogEntry | null;
  /** Bump this (the app's global refreshKey works well) whenever a sync
   * completes -- triggers a brief pulse so "just synced" registers, without
   * needing true in-flight state threaded up from wherever the "Sync now"
   * button actually lives (each platform section owns its own sync
   * trigger). Not the same as "pulses while running", but the visible
   * feedback moment is the same one an analyst actually wants: something
   * happened. */
  pulseKey?: number;
}

export function SyncStatusDot({ lastSync, pulseKey }: Props) {
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (pulseKey === undefined) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 2000);
    return () => clearTimeout(t);
  }, [pulseKey]);

  const tone = !lastSync ? "muted" : lastSync.status === "success" ? "good" : lastSync.status === "partial" ? "warning" : "critical";
  const color = { good: "var(--color-status-good)", warning: "var(--color-status-warning)", critical: "var(--color-status-critical)", muted: "var(--color-ink-muted)" }[tone];
  const label = !lastSync ? "Never synced" : `Last synced ${formatRelativeTime(lastSync.runAt)} — ${lastSync.status}`;

  return (
    <span className="group relative inline-flex items-center" title={label}>
      <span className="relative flex h-2 w-2">
        {pulsing && <span className="absolute inline-flex h-full w-full animate-soft-pulse rounded-full" style={{ background: color }} />}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
    </span>
  );
}
