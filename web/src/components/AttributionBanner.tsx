// Persistent, not dismissable — spec §7.7: readers must never mistake a
// blended figure for an attributed one.
export function AttributionBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-ink-secondary">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-status-warning">
        <path
          d="M8 1.5L15 14H1L8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M8 6.5V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
      </svg>
      <span>
        Each platform below uses its own attribution window (shown per-section). Figures are never summed across
        platforms as a single number — different windows would double-count. Any blended total is explicitly
        labeled <strong className="text-ink-primary">"blended, non-attributed."</strong>
      </span>
    </div>
  );
}
