import type { SyncLogEntry } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { type ComparisonMode } from "../lib/comparisonRange";
import { DateRangePicker } from "./DateRangePicker";
import { SyncStatusDot } from "./SyncStatusDot";

interface Props {
  title: string;
  lastSync: SyncLogEntry | null;
  /** Bumped whenever any sync completes -- see SyncStatusDot's prop comment. */
  syncPulseKey: number;
  /** Mobile only (hidden at sm: and up, where the sidebar is always visible). */
  onOpenNav: () => void;
  grossMargin: number;
  onGrossMarginChange: (v: number) => void;
  targetRoas: number;
  onTargetRoasChange: (v: number) => void;
  comparisonMode: ComparisonMode;
  range: DateRange;
  onApplyDateAndComparison: (range: DateRange, comparisonMode: ComparisonMode) => void;
  onOpenPalette: () => void;
}

/** The one floating glass layer that's always on screen -- everything else
 * (KPI cards, tables, chart plot areas) stays solid per the governing
 * principle (index.css's header comment / spec §0). Sticky so it reads as
 * genuinely elevated above scrolling content, which is what makes the
 * translucency an honest signal of depth rather than decoration. */
export function TopBar({
  title,
  lastSync,
  syncPulseKey,
  onOpenNav,
  grossMargin,
  onGrossMarginChange,
  targetRoas,
  onTargetRoasChange,
  comparisonMode,
  range,
  onApplyDateAndComparison,
  onOpenPalette,
}: Props) {
  return (
    <header className="glass sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1 shrink-0 rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-white/5 sm:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <h2 className="font-display truncate text-base text-ink-primary">{title}</h2>
        <SyncStatusDot lastSync={lastSync} pulseKey={syncPulseKey} />
        <span className="hidden shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-xs font-medium text-ink-secondary sm:inline">
          All figures in INR
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink-secondary"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">Search…</span>
          <kbd className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[10px] sm:inline">⌘K</kbd>
        </button>

        <div className="flex items-center gap-2 text-xs text-ink-secondary">
          <label className="flex items-center gap-1.5" title="Blended gross margin -- drives Profit and Break-even ROAS on the campaign table">
            Margin
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={Math.round(grossMargin * 100)}
              onChange={(e) => onGrossMarginChange(Math.max(1, Math.min(100, Number(e.target.value) || 0)) / 100)}
              className="w-14 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1 text-right tabular-nums text-ink-primary"
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
              onChange={(e) => onTargetRoasChange(Math.max(0, Number(e.target.value) || 0))}
              className="w-14 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1 text-right tabular-nums text-ink-primary"
            />
            x
          </label>
        </div>

        <DateRangePicker value={range} comparisonMode={comparisonMode} onApply={onApplyDateAndComparison} />
      </div>
    </header>
  );
}
