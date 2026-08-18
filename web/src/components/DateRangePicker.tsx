import { useEffect, useRef, useState } from "react";
import type { DateRange } from "../lib/dateRanges";
import { PRESET_LABELS, PRESET_ORDER, presetRange } from "../lib/dateRanges";
import { COMPARISON_LABELS, COMPARISON_MODE_ORDER, type ComparisonMode } from "../lib/comparisonRange";
import { formatDateLabel } from "../lib/format";

interface Props {
  value: DateRange;
  comparisonMode: ComparisonMode;
  onApply: (range: DateRange, comparisonMode: ComparisonMode) => void;
}

/** Date range AND comparison period, merged into one control with a single
 * Apply -- both used to be separate, live-applying controls; picking a
 * preset fired a fetch immediately, and comparison mode was a second
 * dropdown elsewhere in the top bar. Now every choice here is a draft until
 * Apply, so changing your mind about the range while also picking a
 * comparison period doesn't cost two round-trips. */
export function DateRangePicker({ value, comparisonMode, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState(value);
  const [draftComparison, setDraftComparison] = useState(comparisonMode);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Re-seed the draft from the live values whenever the dropdown opens --
  // discards any half-made edits from a previous open-then-click-away.
  function openDropdown() {
    setDraftRange(value);
    setDraftComparison(comparisonMode);
    setCustomFrom(value.from);
    setCustomTo(value.to);
    setOpen(true);
  }

  function apply() {
    onApply(draftRange, draftComparison);
    setOpen(false);
  }

  const label = value.preset === "custom" ? `${formatDateLabel(value.from)} – ${formatDateLabel(value.to)}` : PRESET_LABELS[value.preset];
  const dirty = draftRange.preset !== value.preset || draftRange.from !== value.from || draftRange.to !== value.to || draftComparison !== comparisonMode;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-primary transition-colors hover:bg-surface-2"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-ink-muted">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="tabular-nums">{label}</span>
        {comparisonMode !== "none" && <span className="text-ink-muted">vs {COMPARISON_LABELS[comparisonMode].toLowerCase()}</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Solid, not .glass -- this floats directly over busy KPI tiles/chart
          content with no dimmed backdrop behind it (unlike CommandPalette,
          which has one), so translucency here just reads as illegible
          bleed-through rather than an intentional glass layer. */}
      {open && (
        <div className="animate-fade-slide-in absolute right-0 z-20 mt-1.5 w-80 overflow-hidden rounded-xl border border-border bg-surface-1 shadow-[var(--shadow-glass)]">
          <div className="p-3">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Date range</div>
            <div className="grid grid-cols-2 gap-1">
              {PRESET_ORDER.map((preset) => {
                const selected = draftRange.preset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDraftRange(presetRange(preset))}
                    className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      selected ? "bg-accent-soft text-accent" : "text-ink-primary hover:bg-surface-2"
                    }`}
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setDraftRange({ preset: "custom", from: e.target.value, to: customTo });
                }}
                className="w-full rounded-md border border-border bg-surface-0 px-2 py-1.5 text-sm text-ink-primary tabular-nums"
              />
              <span className="text-ink-muted">–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setDraftRange({ preset: "custom", from: customFrom, to: e.target.value });
                }}
                className="w-full rounded-md border border-border bg-surface-0 px-2 py-1.5 text-sm text-ink-primary tabular-nums"
              />
            </div>
          </div>

          <div className="border-t border-border p-3">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Compare to</div>
            <div className="grid grid-cols-1 gap-1">
              {COMPARISON_MODE_ORDER.map((mode) => {
                const selected = draftComparison === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDraftComparison(mode)}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      selected ? "bg-accent-soft text-accent" : "text-ink-primary hover:bg-surface-2"
                    }`}
                  >
                    {COMPARISON_LABELS[mode]}
                    {selected && (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border p-3">
            <button
              type="button"
              onClick={apply}
              disabled={!dirty}
              className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 transition-[transform,opacity] duration-[var(--duration-micro)] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
