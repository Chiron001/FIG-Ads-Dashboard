import { useEffect } from "react";
import type { ShopifyProductRow } from "@fig/shared";
import { computeProductInsight, INSIGHT_META } from "../lib/productInsight";

interface Props {
  product: ShopifyProductRow;
  previous: ShopifyProductRow | null;
  onClose: () => void;
}

const TONE_TEXT: Record<string, string> = {
  good: "text-status-good",
  warning: "text-status-warning",
  critical: "text-status-critical",
  neutral: "text-ink-muted",
};

/** Full analytical breakdown for one product's "Performance" badge --
 * modeled on KpiExplainDrawer's fixed-position slide-in panel rather than
 * an inline popover, since an inline popover positioned inside this
 * table's horizontally-scrolling container risks getting clipped. Always
 * compares against the immediately-adjacent previous period, independent
 * of whatever the top bar's "Compare to" is set to -- see
 * lib/productInsight.ts's header comment. */
export function ProductPerformanceDrawer({ product, previous, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const insight = computeProductInsight(product, previous);
  const meta = INSIGHT_META[insight.verdict];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50 animate-fade-slide-in" />
      <div
        role="dialog"
        aria-label={`Performance detail for ${product.title ?? product.productId}`}
        className="glass animate-fade-slide-in relative flex h-full w-full max-w-md flex-col overflow-y-auto rounded-l-2xl p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Performance</div>
            <div className="mt-1 truncate text-lg font-semibold text-ink-primary" title={product.title ?? product.productId}>
              {product.title ?? product.productId}
            </div>
            <span
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }}
            >
              {insight.label}
            </span>
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

        <p className={`mt-4 text-sm font-medium leading-relaxed ${TONE_TEXT[insight.tone]}`}>{insight.headline}</p>

        {insight.bullets.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-white/10 pt-4">
            {insight.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-secondary">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Every metric, this period vs. previous</div>
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="px-2.5 py-1.5 text-left font-medium text-ink-muted">Metric</th>
                  <th className="px-2.5 py-1.5 text-right font-medium text-ink-muted">Now</th>
                  <th className="px-2.5 py-1.5 text-right font-medium text-ink-muted">Prior</th>
                  <th className="px-2.5 py-1.5 text-right font-medium text-ink-muted">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {insight.metrics.map((m) => (
                  <tr key={m.label} className="border-b border-border last:border-0">
                    <td className="px-2.5 py-1.5 text-ink-secondary">{m.label}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-ink-primary">{m.current}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-ink-muted">{m.previous}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      {m.delta == null ? (
                        <span className="text-ink-muted">N/A</span>
                      ) : (
                        <span className={m.delta > 0 ? "text-status-good" : m.delta < 0 ? "text-status-critical" : "text-ink-muted"}>
                          {m.delta > 0 ? "▲" : m.delta < 0 ? "▼" : "·"} {(m.delta * 100).toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-auto pt-6 text-xs text-ink-muted">
          Compared against the immediately preceding period of the same length, regardless of the top bar's "Compare to" setting.
        </p>
      </div>
    </div>
  );
}
