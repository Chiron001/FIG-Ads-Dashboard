import { useEffect, useRef, useState } from "react";
import type { DateRange } from "../lib/dateRanges";
import { PRESET_LABELS, PRESET_ORDER, presetRange } from "../lib/dateRanges";
import { formatDateLabel } from "../lib/format";

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

// Preset rows first (dataviz skill: "nobody fights a calendar grid for
// 'last 30 days'"), custom range tucked behind a hairline in the footer.
export function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
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

  const label =
    value.preset === "custom"
      ? `${formatDateLabel(value.from)} – ${formatDateLabel(value.to)}`
      : PRESET_LABELS[value.preset];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-primary hover:bg-surface-2 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-ink-muted">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="tabular-nums">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="glass animate-fade-slide-in absolute right-0 z-20 mt-1.5 w-72 overflow-hidden rounded-xl">
          <div className="p-1.5">
            {PRESET_ORDER.map((preset) => {
              const selected = value.preset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onChange(presetRange(preset));
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-ink-primary transition-colors hover:bg-white/[0.06]"
                >
                  <span>{PRESET_LABELS[preset]}</span>
                  {selected && (
                    <svg width="16" height="16" viewBox="0 0 16 16" className="text-accent">
                      <path
                        d="M3.5 8.5L6.5 11.5L12.5 4.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-white/10 p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Custom range</div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-ink-primary tabular-nums"
              />
              <span className="text-ink-muted">–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-ink-primary tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange({ preset: "custom", from: customFrom, to: customTo });
                setOpen(false);
              }}
              className="mt-2 w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0 transition-[transform,opacity] duration-[var(--duration-micro)] hover:opacity-90 active:scale-[0.98]"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
