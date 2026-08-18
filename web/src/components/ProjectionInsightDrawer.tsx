import { useEffect } from "react";

interface Props {
  productTitle: string;
  label: string;
  color: string;
  message: string;
  onClose: () => void;
}

/** Click-triggered detail panel for one product's Insight badge in the
 * Projection Sheet -- was a native `title` hover tooltip, easy to miss and
 * unusable on touch. Fixed-position, not an inline popover, for the same
 * reason as ProductPerformanceDrawer: this badge sits inside a
 * horizontally- AND vertically-scrolling table pane, and an inline popover
 * anchored there would get clipped by its `overflow: auto`. */
export function ProjectionInsightDrawer({ productTitle, label, color, message, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50 animate-fade-slide-in" />
      <div
        role="dialog"
        aria-label={`Insight detail for ${productTitle}`}
        className="animate-fade-slide-in relative w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-5 shadow-[var(--shadow-glass)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Insight</div>
            <div className="mt-1 truncate text-base font-semibold text-ink-primary" title={productTitle}>
              {productTitle}
            </div>
            <span
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
            >
              {label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-primary"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-ink-secondary">{message}</p>
      </div>
    </div>
  );
}
