import { useEffect, useMemo, useState } from "react";
import type { Platform, MetricsSummaryResponse } from "@fig/shared";
import { ALL_PLATFORMS, PLATFORM_LABELS } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchSummary } from "../lib/api";
import { PLATFORM_COLORS } from "../lib/platformColors";
import { formatCurrency, formatMultiplier } from "../lib/format";
import { PlatformIcon } from "./icons/PlatformIcon";
import { usePrefersReducedMotion } from "../lib/motion";
import { roasColor } from "../lib/roasColor";

interface Props {
  range: DateRange;
  refreshKey: number;
  connected: Record<Platform, boolean>;
  activePlatform: Platform | null;
  targetRoas: number;
  grossMargin: number;
  onSelectPlatform: (platform: Platform) => void;
}

interface Lane {
  platform: Platform;
  spend: number;
  revenue: number;
  roas: number | null;
  yTop: number;
  yBottom: number;
}

const WIDTH = 1000;
const HEIGHT = 190;
const NODE_X = WIDTH * 0.46;
const BAND_X0 = 14; // just past the Total Spend end-bar
const BAND_X1 = WIDTH - 14; // just before the Revenue end-bar
const BAR_W = 6;
const LANE_GAP = 5;
const TOP_PAD = 6;
const BOTTOM_PAD = 6;
const MIN_LANE_H = 12; // a thin platform still reads as a real, visible lane

/** The signature element (UI/UX spec §4/§0): Total Spend -> the four
 * platforms -> Revenue, rendered as an animated proportional flow -- the
 * spec's explicit fallback for when a full multi-width Sankey is more
 * machinery than the moment needs ("an elegant animated proportional-flow
 * bar"). Each platform gets ONE lane, height set by its share of total
 * spend (so the sizing claim in the spec is exactly literal, not sqrt-
 * compressed or otherwise softened), filled with a left-to-right gradient
 * from the platform's own color into a color that encodes its ROAS
 * strength -- spend and performance in the same shape, without needing the
 * width to reconcile against a differently-scaled revenue total. */
export function SpendFlowBand({ range, refreshKey, connected, activePlatform, targetRoas, grossMargin, onSelectPlatform }: Props) {
  const [data, setData] = useState<MetricsSummaryResponse | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hovered, setHovered] = useState<Platform | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    setRevealed(false);
    fetchSummary(range.from, range.to, ALL_PLATFORMS)
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshKey]);

  useEffect(() => {
    if (!data) return;
    if (reducedMotion) {
      setRevealed(true);
      return;
    }
    const t = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(t);
  }, [data, reducedMotion]);

  const lanes = useMemo((): Lane[] => {
    if (!data) return [];
    const rows = data.platforms.filter((p) => connected[p.platform] && p.spend > 0);
    const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
    if (totalSpend <= 0) return [];
    const sorted = [...rows].sort((a, b) => b.spend - a.spend);
    const usableHeight = HEIGHT - TOP_PAD - BOTTOM_PAD - LANE_GAP * (sorted.length - 1);
    // A generous minimum lane height keeps a small platform genuinely
    // visible/hoverable -- if minimums push total height past what's
    // available, shrink everything proportionally rather than overflow.
    const raw = sorted.map((r) => Math.max(MIN_LANE_H, usableHeight * (r.spend / totalSpend)));
    const rawTotal = raw.reduce((s, h) => s + h, 0);
    const scale = rawTotal > usableHeight ? usableHeight / rawTotal : 1;
    let cursor = TOP_PAD;
    return sorted.map((r, i): Lane => {
      const h = raw[i] * scale;
      const lane: Lane = { platform: r.platform, spend: r.spend, revenue: r.revenue, roas: r.roas, yTop: cursor, yBottom: cursor + h };
      cursor += h + LANE_GAP;
      return lane;
    });
  }, [data, connected]);

  if (!data || lanes.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 px-6 py-10 text-center">
        <p className="text-sm text-ink-muted">No spend flow to show for this range — connect a platform or widen the dates.</p>
      </div>
    );
  }

  const totalSpend = lanes.reduce((s, l) => s + l.spend, 0);
  const totalRevenue = lanes.reduce((s, l) => s + l.revenue, 0);
  const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;
  const hoveredLane = lanes.find((l) => l.platform === hovered) ?? null;

  return (
    <div className="relative overflow-visible rounded-xl border border-border bg-surface-1 px-5 pb-4 pt-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-ink-primary">Spend flow</h3>
        <p className="text-xs text-ink-muted">Total Spend → platform → Revenue, sized by spend, colored by ROAS strength</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" style={{ height: 170 }} role="img" aria-label="Spend flow from total spend through each platform to revenue">
          <defs>
            {lanes.map((lane) => (
              <linearGradient key={lane.platform} id={`flow-grad-${lane.platform}`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor={PLATFORM_COLORS[lane.platform]} />
                <stop offset="46%" stopColor={PLATFORM_COLORS[lane.platform]} />
                <stop offset="54%" stopColor={roasColor(lane.roas, targetRoas)} />
                <stop offset="100%" stopColor={roasColor(lane.roas, targetRoas)} />
              </linearGradient>
            ))}
          </defs>

          {/* Total Spend end-bar */}
          <rect x={0} y={TOP_PAD} width={BAR_W} height={HEIGHT - TOP_PAD - BOTTOM_PAD} rx={3} fill="var(--color-ink-muted)" opacity={0.55} />
          {/* Revenue end-bar */}
          <rect x={WIDTH - BAR_W} y={TOP_PAD} width={BAR_W} height={HEIGHT - TOP_PAD - BOTTOM_PAD} rx={3} fill="var(--color-ink-muted)" opacity={0.55} />

          {lanes.map((lane, i) => {
            const isDimmed = hovered !== null && hovered !== lane.platform;
            const isActive = activePlatform === lane.platform;
            const h = lane.yBottom - lane.yTop;
            const delay = reducedMotion ? 0 : i * 110;

            return (
              <g
                key={lane.platform}
                role="button"
                tabIndex={0}
                aria-label={`${PLATFORM_LABELS[lane.platform]}: ${formatCurrency(lane.spend)} spend, ${formatMultiplier(lane.roas)} ROAS. Activate to view this platform.`}
                onMouseEnter={() => setHovered(lane.platform)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(lane.platform)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelectPlatform(lane.platform)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPlatform(lane.platform);
                  }
                }}
                style={{
                  cursor: "pointer",
                  outline: "none",
                  opacity: isDimmed ? 0.32 : 1,
                  transition: `opacity var(--duration-base) var(--ease-signature)`,
                }}
              >
                <rect
                  x={BAND_X0}
                  y={lane.yTop}
                  width={BAND_X1 - BAND_X0}
                  height={h}
                  rx={Math.min(6, h / 2)}
                  fill={`url(#flow-grad-${lane.platform})`}
                  style={{
                    transformOrigin: `${BAND_X0}px 50%`,
                    transform: revealed ? "scaleX(1)" : "scaleX(0)",
                    transition: `transform var(--duration-hero) var(--ease-signature) ${delay}ms`,
                  }}
                />
                {/* Platform node -- a solid marker at the midpoint, the visual "handle" for hover/click/focus. */}
                <rect
                  x={NODE_X - 5}
                  y={lane.yTop}
                  width={10}
                  height={h}
                  rx={2.5}
                  fill={PLATFORM_COLORS[lane.platform]}
                  stroke={isActive ? "var(--color-accent)" : "var(--color-surface-1)"}
                  strokeWidth={isActive ? 2 : 1.5}
                />
              </g>
            );
          })}
        </svg>

        {/* Legend -- always present for >=2 series, doubles as the label
            surface a thin lane has no room to hold inline (dataviz skill:
            "a legend is always present" for 2+ series; color is never the
            only signal here either -- name + spend + ROAS are always text). */}
        <ul className="flex flex-row flex-wrap gap-x-5 gap-y-2 lg:flex-col lg:justify-center">
          {lanes.map((lane) => (
            <li key={lane.platform}>
              <button
                type="button"
                onClick={() => onSelectPlatform(lane.platform)}
                onMouseEnter={() => setHovered(lane.platform)}
                onMouseLeave={() => setHovered(null)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.04]"
              >
                <PlatformIcon platform={lane.platform} size={14} />
                <span className="text-xs font-medium text-ink-primary">{PLATFORM_LABELS[lane.platform]}</span>
                <span className="font-hero-num text-xs tabular-nums text-ink-secondary">{formatCurrency(lane.spend, true)}</span>
                <span className="font-hero-num text-xs tabular-nums text-ink-muted">{formatMultiplier(lane.roas)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <div>
          <div className="text-ink-muted">Total Spend</div>
          <div className="font-hero-num text-lg font-semibold text-ink-primary tabular-nums">{formatCurrency(totalSpend)}</div>
        </div>
        <div className="text-right">
          <div className="text-ink-muted">Revenue (blended, non-attributed)</div>
          <div className="font-hero-num text-lg font-semibold text-ink-primary tabular-nums">
            {formatCurrency(totalRevenue)} <span className="text-sm font-normal text-ink-secondary">· {formatMultiplier(blendedRoas)}</span>
          </div>
        </div>
      </div>

      {hoveredLane && (
        <div className="glass animate-fade-slide-in pointer-events-none absolute left-1/2 top-16 z-10 w-56 -translate-x-1/2 rounded-xl p-3">
          <div className="flex items-center gap-2">
            <PlatformIcon platform={hoveredLane.platform} size={16} />
            <span className="text-sm font-medium text-ink-primary">{PLATFORM_LABELS[hoveredLane.platform]}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-ink-muted">Spend</span>
            <span className="font-hero-num text-right tabular-nums text-ink-primary">{formatCurrency(hoveredLane.spend)}</span>
            <span className="text-ink-muted">Revenue</span>
            <span className="font-hero-num text-right tabular-nums text-ink-primary">{formatCurrency(hoveredLane.revenue)}</span>
            <span className="text-ink-muted">ROAS</span>
            <span className="font-hero-num text-right tabular-nums text-ink-primary">{formatMultiplier(hoveredLane.roas)}</span>
            <span className="text-ink-muted">Profit</span>
            <span className="font-hero-num text-right tabular-nums text-ink-primary">{formatCurrency(hoveredLane.revenue * grossMargin - hoveredLane.spend)}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-ink-muted">Click to view {PLATFORM_LABELS[hoveredLane.platform]}</div>
        </div>
      )}
    </div>
  );
}
