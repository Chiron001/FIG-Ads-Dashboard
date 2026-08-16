import { useEffect } from "react";
import { METRIC_EXPLAINERS } from "../lib/metricExplainers";

interface Props {
  label: string;
  value: string;
  sublabel?: string;
  onClose: () => void;
}

/** "Explain this number" -- clicking a KPI tile opens this glass drawer with
 * the formula and a one-line description, per the signature-interactions
 * spec ("trust through transparency"). Scoped to the formula, not the raw
 * rows behind it -- see metricExplainers.ts's header comment for why. */
export function KpiExplainDrawer({ label, value, sublabel, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const explainer = METRIC_EXPLAINERS[label];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50 animate-fade-slide-in" />
      <div
        role="dialog"
        aria-label={`How ${label} is computed`}
        className="glass animate-fade-slide-in relative flex h-full w-full max-w-sm flex-col rounded-l-2xl p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
            <div className="font-hero-num mt-1 text-3xl font-semibold text-ink-primary">{value}</div>
            {sublabel && <div className="mt-0.5 text-xs text-ink-secondary">{sublabel}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-white/5 hover:text-ink-primary"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          {explainer ? (
            <>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Formula</div>
              <div className="font-hero-num mt-1.5 rounded-md bg-black/20 px-3 py-2 text-sm text-accent">{explainer.formula}</div>
              <p className="mt-4 text-sm leading-relaxed text-ink-secondary">{explainer.description}</p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-ink-secondary">No formula on file for this metric yet -- it's a direct passthrough figure.</p>
          )}
        </div>

        <p className="mt-auto pt-6 text-xs text-ink-muted">Figures reflect the date range and filters currently selected.</p>
      </div>
    </div>
  );
}
